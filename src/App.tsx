import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
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
import { ReferralPersonalDashboard } from "./referral-components";
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

type JoinWaitlistRow = {
  waitlist_position: number | null;
  status: string;
  already_joined: boolean;
  needs_confirmation: boolean;
  referral_code: string | null;
};

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

function extractConfirmationToken(): string | null {
  if (typeof window === "undefined") return null;

  const sanitizeToken = (raw: string | null): string | null => {
    if (!raw) return null;
    const decoded = decodeURIComponent(raw).trim();
    const trimmed = decoded.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
    const normalized = trimmed.replace(/[^a-zA-Z0-9]/g, "");
    return normalized.length > 0 ? normalized : null;
  };

  const fromSearch = sanitizeToken(new URLSearchParams(window.location.search).get("token"));
  if (fromSearch) return fromSearch;

  const hash = window.location.hash ?? "";
  const questionMarkIndex = hash.indexOf("?");
  if (questionMarkIndex !== -1) {
    const hashQuery = hash.slice(questionMarkIndex + 1);
    return sanitizeToken(new URLSearchParams(hashQuery).get("token"));
  }

  return null;
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
      ? leftMockupFiles.map((file) => ({
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
  const [referralCode, setReferralCode] = useState<string | null>(
    initialWaitlist?.referralCode ?? null,
  );
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

  const requestConfirmationEmail = async (targetEmail: string) => {
    const response = await fetch(`${supabaseProjectUrl}/functions/v1/waitlist-send-confirmation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ email: targetEmail }),
    });

    if (!response.ok) {
      throw new Error("Could not send confirmation email right now.");
    }

    setResendCooldown(targetEmail, RESEND_COOLDOWN_SECONDS);
    setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
  };

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
    const { data, error } = await supabase.rpc("join_waitlist", {
      p_email: normalizedEmail,
      p_referral_code: refCode,
    });

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
        setMessage("Already on the list.");
        track("funnel_signup_duplicate", {
          email_domain: email.split("@")[1] || undefined,
        });
      } else {
        setMessage(
          error?.message
            ? `Could not join waitlist: ${error.message}`
            : "Something went wrong. Please try again.",
        );
        track("funnel_signup_failed", {
          code: error?.code,
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
      setResendMessage("");
      persistWaitlistSession({
        email: normalizedEmail,
        needsConfirmation: !!row.needs_confirmation,
        waitlistPosition: row.waitlist_position ?? null,
        referralCode: rc,
      });
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

      // Trigger transactional confirmation mail (best-effort).
      if (row.needs_confirmation) {
        requestConfirmationEmail(normalizedEmail).catch((mailErr) => {
          console.error("Waitlist confirmation mail trigger failed:", mailErr);
        });
      }
    }
    setLoading(false);
  };

  const handleResend = async () => {
    if (!confirmationEmail || resendLoading || resendCooldownSeconds > 0) return;
    setResendLoading(true);
    setResendMessage("");
    setResendCooldown(confirmationEmail, RESEND_COOLDOWN_SECONDS);
    setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    try {
      await requestConfirmationEmail(confirmationEmail);
      setResendMessage("Sent.");
      track("funnel_confirmation_email_resent", {
        email_domain: confirmationEmail.split("@")[1] || undefined,
      });
    } catch {
      setResendMessage("Could not send. Try again.");
      track("funnel_confirmation_email_resend_failed", {
        email_domain: confirmationEmail.split("@")[1] || undefined,
      });
    } finally {
      setResendLoading(false);
    }
  };

  const handleBackToEmailForm = () => {
    const previous = (confirmationEmail ?? email).trim();
    clearWaitlistSession();
    setSubmitted(false);
    setNeedsConfirmation(false);
    setWaitlistPosition(null);
    setConfirmationEmail(null);
    setReferralCode(null);
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
    setReferralCode(null);
    setResendCooldownSeconds(0);
    setResendMessage("");
    setMessage("");
    setEmail("");
  }, []);

  const confirmedOnList =
    submitted && Boolean(confirmationEmail?.trim()) && !needsConfirmation;

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
        <section className="page-section page-section--hero" id="join">
          <div className="page-section__inner">
            <header className="brand">
              <h1 className="logo">
                ECH
                <span className="logo-flower" aria-hidden="true">
                  <span className="logo-flower-back">✿</span>
                  <span className="logo-flower-front">✿</span>
                </span>
                O
              </h1>
              <div className="divider"></div>
            </header>

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
                    "Join"
                  )}
                </button>
                {message ? <p className="status-message">{message}</p> : null}
              </form>
            ) : (
              <div className="fade-in">
                <div className="success">
                  <p>
                    {needsConfirmation
                      ? "Check your inbox to confirm."
                      : "You're on the list."}
                  </p>
                  {!needsConfirmation && waitlistPosition && !confirmedOnList ? (
                    <p className="waitlist-position">
                      <strong>#{waitlistPosition}</strong>
                    </p>
                  ) : null}
                </div>
                {needsConfirmation ? (
                  <>
                    <div className="waitlist-confirmation-actions">
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

            {submitted && confirmationEmail && !needsConfirmation ? (
              <ReferralPersonalDashboard
                supabase={supabase}
                emailGuess={confirmationEmail}
                referralCodeOverride={referralCode}
                onResetLanding={resetLandingFromStats}
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

  const handleConfirm = useCallback(async () => {
    if (!token || confirmed) return;
    if (confirmRunRef.current) return;
    confirmRunRef.current = true;
    setLoading(true);
    setMessage("Confirming…");
    track("funnel_confirmation_attempted");
    try {
      const { data, error } = await supabase.rpc("confirm_waitlist_email", {
        p_token: token,
      });

      if (error || !data || data.length === 0) {
        const rpcMissing =
          error?.code === "PGRST202" ||
          /confirm_waitlist_email/i.test(error?.message ?? "") ||
          /function.*does not exist/i.test(error?.message ?? "");
        if (rpcMissing) {
          setMessage(
            "Confirmation is not deployed yet: RPC confirm_waitlist_email is missing.",
          );
          track("funnel_confirmation_failed", { reason: "rpc_missing" });
          return;
        }

        console.error("Waitlist confirmation failed", {
          code: error?.code,
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
        });
        setMessage("Confirmation failed. Please retry from the latest email link.");
        track("funnel_confirmation_failed", { reason: "rpc_or_data_error", code: error?.code });
        return;
      }

      const row = data[0];
      setConfirmed(true);
      setPosition(row.waitlist_position ?? null);
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
          waitlistPosition: row.waitlist_position ?? null,
          referralCode: refCode,
        });
      }
      track("funnel_email_confirmed", {
        waitlist_position: row.waitlist_position ?? undefined,
        has_referral_code: Boolean(refCode),
      });
      const qs = new URLSearchParams();
      if (row.waitlist_position !== null && row.waitlist_position !== undefined) {
        qs.set("position", String(row.waitlist_position));
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
      const detail =
        err instanceof Error && err.message
          ? isNetwork
            ? ` (network: blocked or wrong Supabase URL — check VITE_SUPABASE_URL has no /rest/v1, ad blockers, VPN)`
            : ` (${err.message})`
          : "";
      setMessage(`Could not confirm right now${detail}.`);
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
                ECH
                <span className="logo-flower" aria-hidden="true">
                  <span className="logo-flower-back">✿</span>
                  <span className="logo-flower-front">✿</span>
                </span>
                O
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
                  <p>{message}</p>
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

export default App;