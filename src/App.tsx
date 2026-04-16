import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ImgHTMLAttributes,
} from "react";
import leftMockupFiles from "virtual:left-mockups";
import {
  HashRouter,
  Link,
  Route,
  Routes,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import "./App.css";
import { supabase, supabaseAnonKey, supabaseProjectUrl } from "./supabase";
import {
  track,
  setAnalyticsConsentWeb,
  ANALYTICS_CONSENT_STORAGE_KEY,
} from "./analytics";
import { PostHogPageviews } from "./posthog-pageviews";
import { FeatureRequestsPage } from "./modules/feature-requests";
import { ReferralPersonalDashboard, type InitialDashboardStats } from "./referral-components";
import { normalizeRpcRows } from "./normalize-rpc-rows";
import {
  captureReferralFromUrl,
  clearConfirmedWaitlistEmail,
  clearReferralStatsVerifiedEmail,
  clearStoredReferralCode,
  clearWaitlistSession,
  getStoredReferralCode,
  markReferralStatsVerifiedEmail,
  persistConfirmedWaitlistEmail,
  persistWaitlistSession,
  readWaitlistSession,
} from "./waitlist-session";
import {
  logWaitlistConfirmationFailure,
  maskWaitlistToken,
  waitlistDebug,
} from "./waitlist-debug";

/** Raster assets under `public/flower-meadow/` (generated from `src/assets/flower_meadow.png`). */
const FLOWER_LOGO_IMG_PROPS: ImgHTMLAttributes<HTMLImageElement> = {
  src: "/flower-meadow/logo-128w.png",
  srcSet:
    "/flower-meadow/logo-64w.png 64w, /flower-meadow/logo-128w.png 128w, /flower-meadow/logo-256w.png 256w",
  sizes: "(max-width: 860px) 6rem, 3.5rem",
  alt: "",
  width: 256,
  height: 256,
  decoding: "async",
};

type JoinWaitlistRow = {
  waitlist_position: number | null;
  total_waitlist_count: number | null;
  status: string;
  already_joined: boolean;
  needs_confirmation: boolean;
  referral_code: string | null;
};

type ExistingDashboardSnapshot = {
  waitlistPosition: number | null;
  totalWaitlistCount: number | null;
  referralCode: string | null;
};

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toOptionalReferralCode(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

const RESEND_COOLDOWN_SECONDS = 60;
const RESEND_STORAGE_PREFIX = "echoo_waitlist_resend_next_at:";

function marketingParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") || undefined,
    utm_medium: params.get("utm_medium") || undefined,
    utm_campaign: params.get("utm_campaign") || undefined,
    utm_term: params.get("utm_term") || undefined,
    utm_content: params.get("utm_content") || undefined,
  };
}

function getResendStorageKey(email: string): string {
  return `${RESEND_STORAGE_PREFIX}${email}`;
}

function setResendCooldown(email: string, cooldownSeconds: number): void {
  if (typeof window === "undefined") return;
  const nextAllowedAtMs = Date.now() + cooldownSeconds * 1000;
  window.localStorage.setItem(getResendStorageKey(email), String(nextAllowedAtMs));
}

function getRemainingResendSeconds(email: string): number {
  if (typeof window === "undefined") return 0;
  const stored = window.localStorage.getItem(getResendStorageKey(email));
  if (!stored) return 0;
  const nextAllowedAtMs = Number.parseInt(stored, 10);
  if (!Number.isFinite(nextAllowedAtMs)) return 0;
  return Math.max(0, Math.ceil((nextAllowedAtMs - Date.now()) / 1000));
}

/**
 * Decode and trim only. `confirm_waitlist_email` normalizes (lower + strip non-alphanumeric) on the server;
 * duplicating aggressive stripping here can corrupt tokens from some mail clients.
 */
function sanitizeConfirmationToken(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  let decoded = raw.trim();
  for (let i = 0; i < 4; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.length > 0 ? decoded : null;
}

const NESTED_LINK_PARAM_KEYS = ["url", "u", "redirect", "redirectUrl", "dest", "target", "location"] as const;

function extractTokenFromSearchParams(params: URLSearchParams): string | null {
  const direct = sanitizeConfirmationToken(params.get("token"));
  if (direct) return direct;

  for (const key of NESTED_LINK_PARAM_KEYS) {
    const wrapped = params.get(key);
    if (!wrapped) continue;
    const nested = extractTokenFromUrlLikeString(wrapped);
    if (nested) return nested;
  }
  return null;
}

/** Parses absolute URLs, hash routes (e.g. #/confirm?token=), and raw strings (incl. nested mail scanner links). */
function extractTokenFromUrlLikeString(raw: string): string | null {
  const decoded = (() => {
    let s = raw.trim();
    for (let i = 0; i < 4; i++) {
      try {
        const next = decodeURIComponent(s);
        if (next === s) break;
        s = next;
      } catch {
        break;
      }
    }
    return s;
  })();

  try {
    const u = new URL(decoded);
    const fromSearch = extractTokenFromSearchParams(u.searchParams);
    if (fromSearch) return fromSearch;
    if (u.hash) {
      const h = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
      const qi = h.indexOf("?");
      if (qi !== -1) {
        const fromHash = extractTokenFromSearchParams(new URLSearchParams(h.slice(qi + 1)));
        if (fromHash) return fromHash;
      }
    }
  } catch {
    // Not an absolute URL — try hash-style fragments below.
  }

  const hashIdx = decoded.indexOf("#");
  if (hashIdx !== -1) {
    const afterHash = decoded.slice(hashIdx + 1);
    const qi = afterHash.indexOf("?");
    if (qi !== -1) {
      const fromHash = extractTokenFromSearchParams(new URLSearchParams(afterHash.slice(qi + 1)));
      if (fromHash) return fromHash;
    }
  }

  const m = /(?:[?&#])token=([^&#'"\s<]+)/i.exec(decoded);
  if (m?.[1]) return sanitizeConfirmationToken(m[1]);

  return null;
}

function extractConfirmationToken(): string | null {
  if (typeof window === "undefined") return null;

  const fromSearch = extractTokenFromSearchParams(new URLSearchParams(window.location.search));
  if (fromSearch) return fromSearch;

  const hash = window.location.hash ?? "";
  const questionMarkIndex = hash.indexOf("?");
  if (questionMarkIndex !== -1) {
    const hashQuery = hash.slice(questionMarkIndex + 1);
    const fromHash = extractTokenFromSearchParams(new URLSearchParams(hashQuery));
    if (fromHash) return fromHash;
  }

  return extractTokenFromUrlLikeString(window.location.href);
}

function supabaseHostForConfirmUi(): string | null {
  try {
    return new URL(supabaseProjectUrl).host;
  } catch {
    return null;
  }
}

function truncateForConfirmUi(s: string | null | undefined, max: number): string {
  if (s == null || s === "") return "";
  const t = String(s);
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * German on-screen explanation when confirmation fails (no secrets; token length only).
 */
function formatGermanConfirmFailureMessage(opts: {
  kind: "rpc_missing" | "empty_rows" | "postgrest" | "network" | "runtime";
  supabaseHost: string | null;
  postgrest?: { code?: string; message?: string; details?: string; hint?: string } | null;
  runtimeMessage?: string;
  tokenLength?: number;
}): string {
  const host = opts.supabaseHost ?? "—";
  const tokenHint =
    opts.tokenLength != null ? `Token-Länge im Link: ${opts.tokenLength} Zeichen.` : null;

  switch (opts.kind) {
    case "rpc_missing":
      return [
        "Bestätigung nicht möglich: Server-Funktion fehlt.",
        "",
        "Technisch: RPC „confirm_waitlist_email“ ist nicht erreichbar oder nicht deployed.",
        `Supabase-Host in dieser App: ${host}`,
        tokenHint,
      ]
        .filter(Boolean)
        .join("\n");
    case "empty_rows":
      return [
        "Bestätigung fehlgeschlagen: Zu diesem Link gibt es keinen passenden Eintrag.",
        "",
        "Mögliche Ursachen:",
        "• Alter Link – neueste E-Mail nutzen oder auf der Waitlist „Erneut senden“.",
        "• Abmeldung – dann neu eintragen.",
        "• Falsches Supabase-Projekt: Diese Seite wurde mit einer anderen VITE_SUPABASE_URL gebaut als das Projekt, das die Mail verschickt.",
        "",
        `Supabase-Host in dieser App: ${host}`,
        tokenHint,
      ]
        .filter(Boolean)
        .join("\n");
    case "postgrest": {
      const e = opts.postgrest;
      const code = e?.code ? String(e.code) : "—";
      const msg = truncateForConfirmUi(e?.message, 320) || "—";
      const details = truncateForConfirmUi(e?.details, 220);
      const hint = truncateForConfirmUi(e?.hint, 220);
      const lines = [
        "Bestätigung fehlgeschlagen: Datenbank hat einen Fehler gemeldet.",
        "",
        `Fehlercode: ${code}`,
        `Meldung: ${msg}`,
      ];
      if (details) lines.push(`Details: ${details}`);
      if (hint) lines.push(`Hinweis: ${hint}`);
      lines.push("", `Supabase-Host in dieser App: ${host}`);
      if (tokenHint) lines.push(tokenHint);
      return lines.join("\n");
    }
    case "network":
      return [
        "Bestätigung derzeit nicht möglich (Netzwerk).",
        "",
        "Typisch: Adblocker, VPN, Firmen-Firewall oder falsche Supabase-URL (ohne /rest/v1).",
        "",
        `Supabase-Host in dieser App: ${host}`,
        tokenHint,
      ]
        .filter(Boolean)
        .join("\n");
    case "runtime": {
      const tech = truncateForConfirmUi(opts.runtimeMessage, 400);
      return [
        "Bestätigung fehlgeschlagen: unerwarteter Fehler in der App.",
        "",
        tech ? `Technisch: ${tech}` : "",
        "",
        `Supabase-Host in dieser App: ${host}`,
        tokenHint,
      ]
        .filter(Boolean)
        .join("\n");
    }
    default:
      return "Bestätigung fehlgeschlagen.";
  }
}

const SHOWCASE_FALLBACK_SLIDES = [
  { image: "/mockups/record-left.png", imageAlt: "Echoo app: record" },
] as const;

const SHOWCASE_HEADLINE = "Journaling made effortlessly";
const SHOWCASE_LEAD =
  "Record a quick memo. Echoo shapes it into entries you can read, search, and share. Start your journey with only two minutes a day.";

function leftMockupAlt(filename: string): string {
  const stem = filename
    .replace(/-left\.png$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return stem ? `Echoo app: ${stem}` : "Echoo app screen";
}

/** Identical segments, gap only inside each segment, so -100%/N hits a perfect loop. */
const SHOWCASE_MARQUEE_SEGMENTS = 4;

function ShowcaseMarquee() {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const baseSlides =
    leftMockupFiles.length > 0
      ? leftMockupFiles
          .filter((file) => !/social/i.test(file.fileName))
          .map((file) => ({
            image: file.image,
            imageAlt: leftMockupAlt(file.fileName),
          }))
      : [...SHOWCASE_FALLBACK_SLIDES];

  const slideCount = baseSlides.length;
  const durationSeconds = Math.max(24, slideCount * 12);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.style.setProperty("--showcase-marquee-duration", `${durationSeconds}s`);
    el.style.setProperty("--showcase-marquee-segments", String(SHOWCASE_MARQUEE_SEGMENTS));
  }, [durationSeconds]);

  return (
    <section className="showcase-section" aria-label="App preview and examples">
      <div className="showcase-panel">
        <header className="showcase-copy">
          <h3 className="showcase-headline">{SHOWCASE_HEADLINE}</h3>
          <p className="showcase-lead">{SHOWCASE_LEAD}</p>
        </header>
        <div
          className="showcase-strip"
          ref={stripRef}
          role="region"
          aria-label="Example app screens, animated preview"
        >
          <div className="showcase-viewport">
            <div className="showcase-track">
              {Array.from({ length: SHOWCASE_MARQUEE_SEGMENTS }, (_, segIndex) => (
                <div
                  key={segIndex}
                  className="showcase-marquee-segment"
                  {...(segIndex > 0 ? { "aria-hidden": true as const } : {})}
                >
                  {baseSlides.map((item, i) => (
                    <div
                      key={`${segIndex}-${item.image}-${i}`}
                      className="showcase-slide"
                    >
                      <img
                        src={item.image}
                        alt={segIndex === 0 ? item.imageAlt : ""}
                        className="showcase-mockup"
                        loading="eager"
                        decoding="async"
                        draggable={false}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function App() {
  return (
    <HashRouter>
      <PostHogPageviews />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/confirm" element={<ConfirmWaitlistPage />} />
        <Route path="/unsubscribe" element={<UnsubscribeWaitlistPage />} />
        <Route path="/confirmed" element={<ConfirmedPage />} />
        <Route
          path="/feature-requests"
          element={<FeatureRequestsPage supabase={supabase} source="waitlist" backTo="/" />}
        />
      </Routes>
    </HashRouter>
  );
}

function LandingPage() {
  const initialWaitlist = readWaitlistSession();
  const initialWaitlistEmail = initialWaitlist?.email?.trim().toLowerCase() ?? null;
  const [email, setEmail] = useState(initialWaitlist?.email ?? "");
  const [submitted, setSubmitted] = useState(!!initialWaitlist);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(
    initialWaitlist?.waitlistPosition ?? null,
  );
  const [needsConfirmation, setNeedsConfirmation] = useState(
    initialWaitlist?.needsConfirmation ?? false,
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(""); // Für Feedback-Texte
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(
    initialWaitlist?.email ?? null,
  );
  const [canResendConfirmation, setCanResendConfirmation] = useState(
    initialWaitlist?.needsConfirmation ?? false,
  );
  const [referralCode, setReferralCode] = useState<string | null>(
    initialWaitlist?.referralCode ?? null,
  );
  const [initialDashboardStats, setInitialDashboardStats] = useState<InitialDashboardStats | null>(
    initialWaitlist?.email
      ? {
          invited_count: 0,
          confirmed_count: 0,
          registered_count: 0,
          rewarded_referrals: 0,
          months_granted_total: 0,
          referral_code: initialWaitlist?.referralCode ?? null,
          waitlist_order: initialWaitlist?.waitlistPosition ?? null,
          leaderboard_rank: null,
          leaderboard_size: null,
          total_confirmed_waitlist: initialWaitlist?.waitlistPosition ?? null,
        }
      : null,
  );
  const [statsReady, setStatsReady] = useState(Boolean(initialWaitlist?.email));
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const signupStartedRef = useRef(false);
  const signupSubmittedRef = useRef(false);
  const signupAbandonTrackedRef = useRef(false);
  const [consent, setConsent] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
      if (stored === "1") return true;
      if (stored === "0") return false;
      return null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    setAnalyticsConsentWeb(consent === true);
  }, [consent]);

  useEffect(() => {
    captureReferralFromUrl();
    const storedRef = getStoredReferralCode();
    if (storedRef) {
      track("referral_visit_attributed", { source: "url_ref_param" });
    }
  }, []);

  const handleConsent = (enabled: boolean) => {
    setConsent(enabled);
    try {
      window.localStorage.setItem(
        ANALYTICS_CONSENT_STORAGE_KEY,
        enabled ? "1" : "0",
      );
    } catch {
      // ignore
    }
    setAnalyticsConsentWeb(enabled);
    track("analytics_consent_updated", { consent_enabled: enabled });
  };

  useEffect(() => {
    if (consent !== true) return;
    track("funnel_landing_viewed", {
      ...marketingParams(),
      referrer: document.referrer || undefined,
    });
  }, [consent]);

  useEffect(() => {
    if (consent !== true) return;
    const maybeTrackAbandon = () => {
      if (!signupStartedRef.current) return;
      if (signupSubmittedRef.current) return;
      if (signupAbandonTrackedRef.current) return;
      signupAbandonTrackedRef.current = true;
      track("funnel_signup_abandoned", {
        reason: "left_before_submit",
        has_email_input: Boolean(email.trim()),
      });
    };

    const onPageHide = () => maybeTrackAbandon();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") maybeTrackAbandon();
    };

    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      maybeTrackAbandon();
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [consent, email]);

  useEffect(() => {
    if (!confirmationEmail) return;

    const syncRemaining = () => {
      setResendCooldownSeconds(getRemainingResendSeconds(confirmationEmail));
    };

    syncRemaining();
    const intervalId = window.setInterval(syncRemaining, 1000);
    return () => window.clearInterval(intervalId);
  }, [confirmationEmail]);

  type ConfirmationSendResult = {
    confirmedSent: boolean;
    reason: string | null;
    retryAfterSeconds: number | null;
  };

  const requestConfirmationEmail = async (
    targetEmail: string,
  ): Promise<ConfirmationSendResult> => {
    const response = await fetch(`${supabaseProjectUrl}/functions/v1/waitlist-send-confirmation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ email: targetEmail }),
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      let detail = "";
      if (payload && typeof payload === "object" && "error" in payload) {
        const raw = (payload as { error?: unknown }).error;
        if (typeof raw === "string" && raw.trim()) {
          detail = raw.trim();
        }
      }
      throw new Error(detail || `HTTP ${response.status}`);
    }

    const isObjectPayload = payload && typeof payload === "object";
    const sentFlag = Boolean(
      isObjectPayload &&
      "sent" in (payload as Record<string, unknown>) &&
      (payload as { sent?: unknown }).sent === true,
    );
    const statusValue =
      isObjectPayload && "status" in (payload as Record<string, unknown>)
        ? String((payload as { status?: unknown }).status ?? "")
        : "";
    const reasonValue =
      isObjectPayload && "reason" in (payload as Record<string, unknown>)
        ? String((payload as { reason?: unknown }).reason ?? "")
        : "";
    const retryAfterRaw =
      isObjectPayload && "retry_after_seconds" in (payload as Record<string, unknown>)
        ? Number((payload as { retry_after_seconds?: unknown }).retry_after_seconds)
        : Number.NaN;
    const retryAfterSeconds = Number.isFinite(retryAfterRaw)
      ? Math.max(0, Math.ceil(retryAfterRaw))
      : null;
    const statusSent = /^sent$/i.test(statusValue.trim());
    const acceptedStatus = /^ok|accepted|queued$/i.test(statusValue.trim());
    const genericOkOnly = Boolean(
      isObjectPayload &&
      Object.keys(payload as Record<string, unknown>).length === 1 &&
      (payload as { ok?: unknown }).ok === true,
    );

    // Endpoint responded with an unexpected payload.
    if (!sentFlag && !statusSent && !acceptedStatus && !genericOkOnly && payload !== null) {
      throw new Error(`Mail endpoint returned non-send payload: ${JSON.stringify(payload)}`);
    }

    setResendCooldown(targetEmail, RESEND_COOLDOWN_SECONDS);
    setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    return {
      confirmedSent: sentFlag || statusSent,
      reason: reasonValue || null,
      retryAfterSeconds,
    };
  };

  const runResendFlow = async (
    targetEmail: string,
    source: "auto" | "button",
  ): Promise<ConfirmationSendResult> => {
    setResendLoading(true);
    setResendMessage(source === "button" ? "Sending..." : "Sending confirmation email...");
    setResendCooldown(targetEmail, RESEND_COOLDOWN_SECONDS);
    setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    try {
      const result = await requestConfirmationEmail(targetEmail);
      if (result.confirmedSent) {
        setResendMessage("Sent.");
      } else if (result.reason === "cooldown") {
        const suffix =
          result.retryAfterSeconds !== null
            ? `Please wait ${result.retryAfterSeconds}s before sending again.`
            : "Please wait before sending again.";
        setResendMessage(suffix);
      } else {
        setResendMessage("Could not confirm sending. Please try again.");
      }
      return result;
    } catch (err) {
      const detail = err instanceof Error ? err.message : "unknown_error";
      const isExplicitPayloadError = /Mail endpoint returned non-send payload/i.test(detail);
      setResendMessage(
        isExplicitPayloadError
          ? "Could not confirm sending. Please try again."
          : "Could not send confirmation email. Try again.",
      );
      throw err;
    } finally {
      setResendLoading(false);
    }
  };

  const joinWaitlistWithRetry = async (targetEmail: string, targetReferralCode: string | null) => {
    const retryDelaysMs = [800, 1600];
    let lastResult: Awaited<
      ReturnType<typeof supabase.rpc<"join_waitlist", JoinWaitlistRow[]>>
    > | null = null;

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      const result = await supabase.rpc("join_waitlist", {
        p_email: targetEmail,
        p_referral_code: targetReferralCode,
      });
      lastResult = result;

      const isTransientLoadFailed =
        !!result.error && /TypeError:\s*Load failed/i.test(result.error.message ?? "");

      if (!isTransientLoadFailed || attempt === retryDelaysMs.length) {
        return result;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, retryDelaysMs[attempt]);
      });
    }

    return (
      lastResult ?? {
        data: null,
        error: {
          name: "RetryError",
          message: "Could not join waitlist after retries.",
        } as unknown as Awaited<
          ReturnType<typeof supabase.rpc<"join_waitlist", JoinWaitlistRow[]>>
        >["error"],
      }
    );
  };

  const loadExistingDashboardSnapshot = useCallback(
    async (targetEmail: string): Promise<ExistingDashboardSnapshot | null> => {
      const dash = await supabase.rpc("referral_my_dashboard_stats", { p_email: targetEmail });
      if (dash.error) return null;
      const row = Array.isArray(dash.data) ? dash.data[0] : dash.data;
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      return {
        waitlistPosition: toOptionalNumber(record.waitlist_order ?? record.waitlistOrder),
        totalWaitlistCount: toOptionalNumber(
          record.total_confirmed_waitlist ?? record.totalConfirmedWaitlist,
        ),
        referralCode: toOptionalReferralCode(record.referral_code),
      };
    },
    [],
  );

  const queueStatsReveal = useCallback(() => {
    setStatsReady(false);
    window.setTimeout(() => {
      setStatsReady(true);
    }, 350);
  }, []);

  const buildInitialDashboardStats = useCallback(
    (
      waitlistPosition: number | null | undefined,
      totalWaitlistCount: number | null | undefined,
      nextReferralCode: string | null | undefined,
    ): InitialDashboardStats => ({
      invited_count: 0,
      confirmed_count: 0,
      registered_count: 0,
      rewarded_referrals: 0,
      months_granted_total: 0,
      referral_code: nextReferralCode ?? null,
      waitlist_order: waitlistPosition ?? null,
      leaderboard_rank: null,
      leaderboard_size: null,
      total_confirmed_waitlist: totalWaitlistCount ?? waitlistPosition ?? null,
    }),
    [],
  );

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMessage(""); // Reset message
    signupSubmittedRef.current = true;

    track("funnel_signup_submitted", {
      email_domain: email.split("@")[1] || undefined,
      ...marketingParams(),
      referrer: document.referrer || undefined,
    });

    const normalizedEmail = email.trim().toLowerCase();
    const refCode = getStoredReferralCode();
    const { data, error } = await joinWaitlistWithRetry(normalizedEmail, refCode);

    const row = (Array.isArray(data) ? data[0] : null) as JoinWaitlistRow | null;

    if (error || !row) {
      const rpcMissing =
        error?.code === "PGRST202" ||
        /join_waitlist/i.test(error?.message ?? "") ||
        /function.*does not exist/i.test(error?.message ?? "");

      if (rpcMissing) {
        setMessage("Backend migration missing: please deploy the waitlist confirmation RPCs.");
        setLoading(false);
        return;
      }

      // Prüfen, ob die Email bereits existiert (PostgREST error code 23505)
      if (error?.code === "23505") {
        const existingSessionMatches =
          initialWaitlistEmail !== null && initialWaitlistEmail === normalizedEmail;
        let duplicateNeedsConfirmation = existingSessionMatches
          ? !!initialWaitlist?.needsConfirmation
          : true;
        let duplicateWaitlistPosition = existingSessionMatches
          ? initialWaitlist?.waitlistPosition ?? null
          : null;
        let duplicateReferralCode = existingSessionMatches
          ? initialWaitlist?.referralCode ?? null
          : null;
        let duplicateTotalWaitlistCount = duplicateWaitlistPosition;

        if (!existingSessionMatches) {
          const [{ data: isConfirmed }, dashboardSnapshot] = await Promise.all([
            supabase.rpc("waitlist_email_exists", { p_email: normalizedEmail }),
            loadExistingDashboardSnapshot(normalizedEmail),
          ]);

          if (isConfirmed === true) {
            duplicateNeedsConfirmation = false;
            duplicateWaitlistPosition = dashboardSnapshot?.waitlistPosition ?? null;
            duplicateReferralCode = dashboardSnapshot?.referralCode ?? null;
            duplicateTotalWaitlistCount =
              dashboardSnapshot?.totalWaitlistCount ?? dashboardSnapshot?.waitlistPosition ?? null;
            persistConfirmedWaitlistEmail(normalizedEmail);
            markReferralStatsVerifiedEmail(normalizedEmail);
          }
        }

        setSubmitted(true);
        setConfirmationEmail(normalizedEmail);
        setNeedsConfirmation(duplicateNeedsConfirmation);
        setWaitlistPosition(duplicateWaitlistPosition);
        setReferralCode(duplicateReferralCode);
        setInitialDashboardStats(
          buildInitialDashboardStats(
            duplicateWaitlistPosition,
            duplicateTotalWaitlistCount,
            duplicateReferralCode,
          ),
        );
        setCanResendConfirmation(duplicateNeedsConfirmation);
        setResendMessage("");
        setMessage("");
        persistWaitlistSession({
          email: normalizedEmail,
          needsConfirmation: duplicateNeedsConfirmation,
          waitlistPosition: duplicateWaitlistPosition,
          confirmationMailSent:
            existingSessionMatches ? Boolean(initialWaitlist?.confirmationMailSent) : false,
          referralCode: duplicateReferralCode,
        });
        queueStatsReveal();
        track("funnel_signup_duplicate", {
          email_domain: email.split("@")[1] || undefined,
        });
      } else {
        const isLoadFailed = /TypeError:\s*Load failed/i.test(error?.message ?? "");
        setMessage(
          isLoadFailed
            ? "Network hiccup while joining waitlist. Please try again."
            : error?.message
              ? `Could not join waitlist: ${error.message}`
              : "Something went wrong. Please try again.",
        );
        track("funnel_signup_failed", {
          code: error?.code,
          reason: isLoadFailed ? "load_failed" : undefined,
        });
      }
    } else {
      clearStoredReferralCode();
      setSubmitted(true);
      setWaitlistPosition(row.waitlist_position ?? null);
      setNeedsConfirmation(!!row.needs_confirmation);
      setConfirmationEmail(normalizedEmail);
      const rc =
        typeof row.referral_code === "string" && row.referral_code.trim()
          ? row.referral_code.trim().toLowerCase()
          : null;
      setReferralCode(rc);
      setInitialDashboardStats(
        buildInitialDashboardStats(row.waitlist_position, row.total_waitlist_count, rc),
      );
      setResendMessage("");
      persistWaitlistSession({
        email: normalizedEmail,
        needsConfirmation: !!row.needs_confirmation,
        waitlistPosition: row.waitlist_position ?? null,
        confirmationMailSent: !row.needs_confirmation,
        referralCode: rc,
      });
      queueStatsReveal();
      if (!row.needs_confirmation) {
        persistConfirmedWaitlistEmail(normalizedEmail);
        markReferralStatsVerifiedEmail(normalizedEmail);
      }
      track("funnel_signup_succeeded", {
        email_domain: email.split("@")[1] || undefined,
        waitlist_position: row.waitlist_position ?? undefined,
        used_referral_code: Boolean(refCode),
        needs_confirmation: Boolean(row.needs_confirmation),
      });

      // Always allow resend while confirmation is pending, even when initial mail did not arrive.
      const allowResendForThisSession = row.needs_confirmation;
      setCanResendConfirmation(allowResendForThisSession);

      // Trigger confirmation immediately whenever this email still needs confirmation.
      if (row.needs_confirmation) {
        try {
          // Execute the exact same resend flow as the button, just triggered automatically.
          let autoResult = await runResendFlow(normalizedEmail, "auto");
          if (!autoResult.confirmedSent) {
            const waitMs =
              autoResult.reason === "cooldown" && autoResult.retryAfterSeconds !== null
                ? autoResult.retryAfterSeconds * 1000 + 300
                : 1200;
            await new Promise<void>((resolve) => window.setTimeout(resolve, waitMs));
            autoResult = await runResendFlow(normalizedEmail, "auto");
          }
          setResendMessage(
            autoResult.confirmedSent
              ? "Confirmation email sent."
              : "Could not send confirmation email automatically. Please tap Resend.",
          );
          if (autoResult.confirmedSent) {
            persistWaitlistSession({
              email: normalizedEmail,
              needsConfirmation: true,
              waitlistPosition: row.waitlist_position ?? null,
              confirmationMailSent: true,
              referralCode: rc,
            });
          }
          track("funnel_confirmation_email_auto_sent", {
            email_domain: normalizedEmail.split("@")[1] || undefined,
            confirmed_sent: autoResult.confirmedSent,
          });
        } catch (mailErr) {
          setResendMessage("Could not send confirmation email automatically. Please tap Resend.");
          track("funnel_confirmation_email_initial_send_failed", {
            email_domain: normalizedEmail.split("@")[1] || undefined,
          });
          console.error("Waitlist confirmation mail trigger failed:", mailErr);
        }
      }
    }
    setLoading(false);
  };

  const handleResend = async () => {
    if (!confirmationEmail || resendLoading || resendCooldownSeconds > 0) return;
    try {
      const result = await runResendFlow(confirmationEmail, "button");
      if (result.confirmedSent) {
        persistWaitlistSession({
          email: confirmationEmail,
          needsConfirmation: true,
          waitlistPosition,
          confirmationMailSent: true,
          referralCode,
        });
      }
      track("funnel_confirmation_email_resent", {
        email_domain: confirmationEmail.split("@")[1] || undefined,
      });
    } catch {
      track("funnel_confirmation_email_resend_failed", {
        email_domain: confirmationEmail.split("@")[1] || undefined,
      });
    }
  };

  const handleBackToEmailForm = () => {
    const previous = (confirmationEmail ?? email).trim();
    clearWaitlistSession();
    setSubmitted(false);
    setNeedsConfirmation(false);
    setWaitlistPosition(null);
    setConfirmationEmail(null);
    setCanResendConfirmation(false);
    setReferralCode(null);
    setInitialDashboardStats(null);
    setStatsReady(false);
    setResendMessage("");
    setMessage("");
    setEmail(previous);
    track("funnel_signup_change_email_clicked");
  };

  const resetLandingFromStats = useCallback(() => {
    clearWaitlistSession();
    clearConfirmedWaitlistEmail();
    clearReferralStatsVerifiedEmail();
    setSubmitted(false);
    setNeedsConfirmation(false);
    setWaitlistPosition(null);
    setConfirmationEmail(null);
    setCanResendConfirmation(false);
    setReferralCode(null);
    setInitialDashboardStats(null);
    setStatsReady(false);
    setResendCooldownSeconds(0);
    setResendMessage("");
    setMessage("");
    setEmail("");
  }, []);

  return (
    <div className="app-container">
      {consent === null && (
        <div className="consent-banner">
          <p>Anonymous analytics to improve this page. No journal content.</p>
          <div className="consent-actions">
            <button type="button" onClick={() => handleConsent(false)}>
              Decline
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => handleConsent(true)}
            >
              Accept
            </button>
          </div>
        </div>
      )}
      <main className="page">
        <section className="page-section page-section--hero landing-hero" id="join">
          <div className="page-section__inner landing-hero__inner">
            <header className="brand landing-hero__brand">
              <h1 className="logo">
                <span className="logo-word">ECH</span>
                <span className="logo-flower" aria-hidden="true">
                  <img {...FLOWER_LOGO_IMG_PROPS} />
                </span>
                <span className="logo-word">O</span>
              </h1>
              <div className="divider"></div>
            </header>

            <div className="landing-hero__center">
              <section className="hero-text">
                <h2>Your day, your voice, your echoo.</h2>
                <p>Early access · voice-first journal · pro for free for up to 24 months</p>
              </section>

              {!submitted ? (
                <form onSubmit={handleSubmit} className="minimal-form">
                  <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => {
                      const next = e.target.value;
                      setEmail(next);
                      if (!signupStartedRef.current && next.trim().length > 0) {
                        signupStartedRef.current = true;
                        track("funnel_signup_started", {
                          source: "landing",
                        });
                      }
                    }}
                    required
                  />
                  <button type="submit" disabled={loading}>
                    {loading ? (
                      <span className="btn-loading-content">
                        <span className="ui-spinner ui-spinner--btn" aria-hidden />
                        <span>Joining…</span>
                      </span>
                    ) : (
                      "Join/See stats"
                    )}
                  </button>
                  {message ? <p className="status-message">{message}</p> : null}
                </form>
              ) : (
                <div className="fade-in">
                  <div className="success">
                    <p>
                      {needsConfirmation
                        ? "You are on the waitlist. Please confirm your mail to receive your referral link and to access feature request."
                        : "You are on the waitlist for echoo."}
                    </p>
                    {waitlistPosition ? (
                      <p className="waitlist-position">
                        <strong>#{waitlistPosition}</strong>
                      </p>
                    ) : null}
                  </div>
                  {needsConfirmation ? (
                    <>
                      <div className="waitlist-confirmation-actions">
                        {canResendConfirmation ? (
                          <>
                            <button
                              type="button"
                              onClick={handleResend}
                              disabled={resendLoading || resendCooldownSeconds > 0}
                              className="resend-text-link"
                              aria-label={
                                resendCooldownSeconds > 0
                                  ? `Resend available in ${resendCooldownSeconds} seconds`
                                  : "Resend confirmation email"
                              }
                            >
                              {resendLoading ? (
                                <>
                                  <span className="ui-spinner ui-spinner--btn" aria-hidden />
                                  <span>Sending…</span>
                                </>
                              ) : resendCooldownSeconds > 0 ? (
                                `${resendCooldownSeconds}s`
                              ) : (
                                "Resend"
                              )}
                            </button>
                            <span className="waitlist-confirmation-actions__sep" aria-hidden>
                              ·
                            </span>
                          </>
                        ) : null}
                        <button
                          type="button"
                          onClick={handleBackToEmailForm}
                          className="resend-text-link"
                        >
                          Change email
                        </button>
                      </div>
                      {resendMessage ? <p className="status-message">{resendMessage}</p> : null}
                    </>
                  ) : null}
                </div>
              )}

              {submitted && confirmationEmail && statsReady ? (
                <ReferralPersonalDashboard
                  supabase={supabase}
                  emailGuess={confirmationEmail}
                  referralCodeOverride={needsConfirmation ? null : referralCode}
                  initialStats={initialDashboardStats}
                  onResetLanding={resetLandingFromStats}
                  statsGatePendingConfirmation={needsConfirmation}
                />
              ) : null}

              <div className="landing-links-row">
                <Link
                  to="/feature-requests"
                  className="feature-request-link"
                  onClick={() => track("funnel_feature_requests_link_clicked", { source: "landing" })}
                >
                  Features
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="page-section page-section--wash">
          <ShowcaseMarquee />
        </section>
      </main>

      <footer className="footer page-footer">
        <div className="page-footer__inner">
          <span>Built with love</span>
          <span className="dot">♥</span>
        </div>
      </footer>
    </div>
  );
}

type ConfirmWaitlistRpcOutcome = {
  rows: Record<string, unknown>[];
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
  rpcMissing: boolean;
};

const confirmWaitlistInflight = new Map<string, Promise<ConfirmWaitlistRpcOutcome>>();

async function rpcConfirmWaitlistEmailDeduped(token: string): Promise<ConfirmWaitlistRpcOutcome> {
  const existing = confirmWaitlistInflight.get(token);
  if (existing) return existing;

  const task = (async (): Promise<ConfirmWaitlistRpcOutcome> => {
    let supabaseHost: string | null = null;
    try {
      supabaseHost = new URL(supabaseProjectUrl).host;
    } catch {
      supabaseHost = null;
    }
    waitlistDebug("confirm_waitlist_email:request", {
      token: maskWaitlistToken(token),
      supabaseHost,
    });
    const { data, error } = await supabase.rpc("confirm_waitlist_email", {
      p_token: token,
    });
    const rows = normalizeRpcRows(data);
    const err = error as ConfirmWaitlistRpcOutcome["error"];
    const rpcMissing =
      !!err &&
      (err.code === "PGRST202" ||
        /confirm_waitlist_email/i.test(err.message ?? "") ||
        /function.*does not exist/i.test(err.message ?? ""));
    const responseDiag = {
      rowCount: rows.length,
      rpcMissing,
      errorCode: err?.code ?? null,
      errorMessage: err?.message ?? null,
      errorDetails: err?.details ?? null,
      errorHint: err?.hint ?? null,
      dataShape:
        data == null ? "null" : Array.isArray(data) ? `array(${data.length})` : typeof data,
      emptyRowsNoError: rows.length === 0 && !err,
    };
    waitlistDebug("confirm_waitlist_email:response", responseDiag);
    if (rows.length === 0 && !rpcMissing) {
      waitlistDebug("confirm_waitlist_email:empty_rows_hint", {
        meaning:
          "RPC returned no rows: token not in DB, entry unsubscribed, or anon calling wrong Supabase project.",
        token: maskWaitlistToken(token),
      });
    }
    return { rows, error: err, rpcMissing };
  })();

  confirmWaitlistInflight.set(token, task);
  try {
    return await task;
  } finally {
    confirmWaitlistInflight.delete(token);
  }
}

function ConfirmWaitlistPage() {
  const navigate = useNavigate();
  const token = extractConfirmationToken();
  const confirmRunRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(
    token ? "Confirming…" : "Invalid link.",
  );
  const [position, setPosition] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let supabaseHost: string | null = null;
    try {
      supabaseHost = new URL(supabaseProjectUrl).host;
    } catch {
      supabaseHost = null;
    }
    waitlistDebug("confirm page:context", {
      hasToken: Boolean(token),
      token: token ? maskWaitlistToken(token) : null,
      origin: typeof window !== "undefined" ? window.location.origin : null,
      pathname: typeof window !== "undefined" ? window.location.pathname : null,
      hashPath: typeof window !== "undefined" ? window.location.hash.split("?")[0] || null : null,
      hasSearchParams: Boolean(
        typeof window !== "undefined" && window.location.search && window.location.search.length > 1,
      ),
      supabaseHost,
    });
  }, [token]);

  const handleConfirm = useCallback(async () => {
    if (!token || confirmed) return;
    if (confirmRunRef.current) return;
    confirmRunRef.current = true;
    setLoading(true);
    setMessage("Confirming…");
    track("funnel_confirmation_attempted");
    try {
      const { rows, error, rpcMissing } = await rpcConfirmWaitlistEmailDeduped(token);

      if (rpcMissing) {
        const supabaseHost = supabaseHostForConfirmUi();
        logWaitlistConfirmationFailure({
          failureKind: "rpc_not_deployed",
          token: token ? maskWaitlistToken(token) : null,
          tokenLength: token?.length ?? 0,
          supabaseHost,
          nextSteps: "Deploy migration with confirm_waitlist_email and grant execute to anon.",
        });
        setMessage(
          formatGermanConfirmFailureMessage({
            kind: "rpc_missing",
            supabaseHost,
            tokenLength: token?.length,
          }),
        );
        track("funnel_confirmation_failed", { reason: "rpc_missing" });
        return;
      }

      if (error || rows.length === 0) {
        const supabaseHost = supabaseHostForConfirmUi();
        const failureKind = error ? "postgrest_error" : "empty_rpc_rows";
        logWaitlistConfirmationFailure({
          failureKind,
          rowCount: rows.length,
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? null,
          errorDetails: error?.details ?? null,
          errorHint: error?.hint ?? null,
          token: token ? maskWaitlistToken(token) : null,
          tokenLength: token?.length ?? 0,
          supabaseHost,
          nextSteps:
            failureKind === "empty_rpc_rows"
              ? "No row matched token (expired/resend, unsubscribe, or VITE_SUPABASE_URL points at another project)."
              : "See PostgREST error fields; check RLS, grants, and network.",
        });
        setMessage(
          formatGermanConfirmFailureMessage({
            kind: error ? "postgrest" : "empty_rows",
            supabaseHost,
            postgrest: error,
            tokenLength: token?.length,
          }),
        );
        track("funnel_confirmation_failed", { reason: "rpc_or_data_error", code: error?.code });
        return;
      }

      const row = rows[0];
      const rowPos = toOptionalNumber(row.waitlist_position);
      setConfirmed(true);
      setPosition(rowPos);
      setMessage("Confirmed.");
      const confirmedEmail =
        typeof row.email === "string" && row.email.trim().length > 0 ? row.email.trim() : "";
      const refCode =
        typeof (row as { referral_code?: string }).referral_code === "string" &&
        (row as { referral_code?: string }).referral_code?.trim()
          ? String((row as { referral_code?: string }).referral_code).trim().toLowerCase()
          : null;
      if (confirmedEmail) {
        persistConfirmedWaitlistEmail(confirmedEmail);
        markReferralStatsVerifiedEmail(confirmedEmail);
        persistWaitlistSession({
          email: confirmedEmail.toLowerCase(),
          needsConfirmation: false,
          waitlistPosition: rowPos,
          referralCode: refCode,
        });
      }
      track("funnel_email_confirmed", {
        waitlist_position: rowPos ?? undefined,
        has_referral_code: Boolean(refCode),
      });
      waitlistDebug("confirm page:success", {
        waitlistPosition: rowPos,
        hasReferralCode: Boolean(refCode),
        emailDomain: confirmedEmail.includes("@")
          ? confirmedEmail.split("@")[1]?.toLowerCase()
          : null,
      });
      const qs = new URLSearchParams();
      if (rowPos !== null) {
        qs.set("position", String(rowPos));
      }
      if (confirmedEmail) {
        qs.set("email", confirmedEmail.toLowerCase());
      }
      if (refCode) {
        qs.set("ref", refCode);
      }
      const query = qs.toString();
      navigate(`/confirmed${query ? `?${query}` : ""}`, { replace: true });
    } catch (err) {
      const isNetwork =
        err instanceof TypeError &&
        typeof err.message === "string" &&
        /failed to fetch|networkerror|load failed/i.test(err.message);
      const supabaseHost = supabaseHostForConfirmUi();
      logWaitlistConfirmationFailure({
        failureKind: "runtime_or_network",
        isNetwork,
        message: err instanceof Error ? err.message : String(err),
        token: token ? maskWaitlistToken(token) : null,
        tokenLength: token?.length ?? 0,
        supabaseHost,
        nextSteps: isNetwork
          ? "Check VITE_SUPABASE_URL (no /rest/v1), ad blockers, VPN, CORS."
          : "Unexpected error during confirm; see message.",
      });
      setMessage(
        formatGermanConfirmFailureMessage({
          kind: isNetwork ? "network" : "runtime",
          supabaseHost,
          runtimeMessage: err instanceof Error ? err.message : String(err),
          tokenLength: token?.length,
        }),
      );
      track("funnel_confirmation_failed", { reason: "network_or_runtime_error" });
    } finally {
      setLoading(false);
      confirmRunRef.current = false;
    }
  }, [confirmed, navigate, token]);

  useEffect(() => {
    if (!token) return;
    handleConfirm().catch(() => undefined);
  }, [handleConfirm, token]);

  return (
    <div className="app-container">
      <main className="page">
        <section className="page-section page-section--hero">
          <div className="page-section__inner">
            <header className="brand">
              <h1 className="logo">
                <span className="logo-word">ECH</span>
                <span className="logo-flower" aria-hidden="true">
                  <img {...FLOWER_LOGO_IMG_PROPS} />
                </span>
                <span className="logo-word">O</span>
              </h1>
              <div className="divider"></div>
            </header>

            <section className="hero-text" aria-live="polite">
              <h2>Confirm email</h2>
              <div className="confirm-feedback">
                {loading ? (
                  <p className="confirm-feedback-loading" role="status">
                    <span className="ui-spinner ui-spinner--lg" aria-hidden />
                    <span>{message}</span>
                  </p>
                ) : (
                  <p className="confirm-feedback-message">{message}</p>
                )}
              </div>
              {!loading && position ? (
                <p className="waitlist-position">
                  <strong>#{position}</strong>
                </p>
              ) : null}
              <Link to="/" className="feature-request-link">
                Home
              </Link>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}

function ConfirmedPage() {
  const [searchParams] = useSearchParams();
  const positionParam = searchParams.get("position");
  const emailParam = searchParams.get("email");
  const refParam = searchParams.get("ref");
  const waitlistPosition =
    positionParam && /^\d+$/.test(positionParam)
      ? Number.parseInt(positionParam, 10)
      : null;

  useEffect(() => {
    if (!emailParam?.trim()) return;
    const e = emailParam.trim().toLowerCase();
    markReferralStatsVerifiedEmail(e);
    persistConfirmedWaitlistEmail(e);
    persistWaitlistSession({
      email: e,
      needsConfirmation: false,
      waitlistPosition,
      referralCode: refParam?.trim().toLowerCase() ?? null,
    });
  }, [emailParam, waitlistPosition, refParam]);

  useEffect(() => {
    track("funnel_confirmed_page_viewed", {
      has_position: waitlistPosition !== null,
      has_referral_code: Boolean(refParam?.trim()),
    });
  }, [refParam, waitlistPosition]);

  const featureRequestsTo =
    emailParam && emailParam.trim()
      ? `/feature-requests?email=${encodeURIComponent(emailParam.trim().toLowerCase())}`
      : "/feature-requests";

  const sessionSnap = readWaitlistSession();
  const referralDashboardEmail =
    emailParam?.trim().toLowerCase() || sessionSnap?.email || null;
  const referralDashboardRef =
    refParam?.trim().toLowerCase() || sessionSnap?.referralCode || null;
  const confirmedInitialStats: InitialDashboardStats | null =
    referralDashboardEmail || referralDashboardRef || waitlistPosition !== null
      ? {
          invited_count: 0,
          confirmed_count: 0,
          registered_count: 0,
          rewarded_referrals: 0,
          months_granted_total: 0,
          referral_code: referralDashboardRef,
          waitlist_order: waitlistPosition,
          leaderboard_rank: null,
          leaderboard_size: null,
          total_confirmed_waitlist: waitlistPosition,
        }
      : null;

  return (
    <div className="app-container">
      <main className="page">
        <section className="page-section page-section--hero page-section--confirmed">
          <div className="page-section__inner">
            <div className="confirmed-stack">
              <h2 className="confirmed-title">On the list.</h2>
              <p className="confirmed-lead">We&apos;ll email you when Echoo is ready.</p>
              <ReferralPersonalDashboard
                supabase={supabase}
                emailGuess={referralDashboardEmail}
                referralCodeOverride={referralDashboardRef}
                initialStats={confirmedInitialStats}
              />
              <div className="landing-links-row">
                <Link to={featureRequestsTo} className="feature-request-link">
                  Features
                </Link>
                <Link to="/" className="feature-request-link">
                  Home
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function UnsubscribeWaitlistPage() {
  const token = extractConfirmationToken();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(
    token ? "Processing unsubscribe..." : "Invalid link.",
  );
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!token || done) return;
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc("unsubscribe_waitlist_email", {
          p_token: token,
        });
        if (cancelled) return;

        if (error) {
          const rpcMissing =
            error.code === "PGRST202" ||
            /unsubscribe_waitlist_email/i.test(error.message ?? "") ||
            /function.*does not exist/i.test(error.message ?? "");
          setMessage(
            rpcMissing
              ? "Unsubscribe is not deployed yet: RPC unsubscribe_waitlist_email is missing."
              : "Could not unsubscribe right now. Please try again later.",
          );
          return;
        }

        const row = Array.isArray(data) ? data[0] : null;
        if (!row || row.unsubscribed !== true) {
          setMessage("Invalid or expired unsubscribe link.");
          return;
        }

        clearWaitlistSession();
        clearConfirmedWaitlistEmail();
        clearReferralStatsVerifiedEmail();
        setDone(true);
        setMessage("You have successfully unsubscribed.");
      } catch {
        if (cancelled) return;
        setMessage("Could not unsubscribe right now. Please try again later.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [done, token]);

  return (
    <div className="app-container">
      <main className="page">
        <section className="page-section page-section--hero">
          <div className="page-section__inner">
            <header className="brand">
              <h1 className="logo">
                <span className="logo-word">ECH</span>
                <span className="logo-flower" aria-hidden="true">
                  <img {...FLOWER_LOGO_IMG_PROPS} />
                </span>
                <span className="logo-word">O</span>
              </h1>
              <div className="divider"></div>
            </header>
            <section className="hero-text" aria-live="polite">
              <h2>Unsubscribe</h2>
              <div className="confirm-feedback">
                {loading ? (
                  <p className="confirm-feedback-loading" role="status">
                    <span className="ui-spinner ui-spinner--lg" aria-hidden />
                    <span>{message}</span>
                  </p>
                ) : (
                  <p>{message}</p>
                )}
              </div>
              <Link to="/" className="feature-request-link">
                Home
              </Link>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;