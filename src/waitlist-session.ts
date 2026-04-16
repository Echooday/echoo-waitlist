export const WAITLIST_SESSION_KEY = "echoo_waitlist_session";
export const WAITLIST_GATE_VERIFIED_KEY = "echoo_waitlist_gate_verified_email";

const FEATURE_ACCESS_KEY = "echoo_feature_access_email";
const FEATURE_VOTER_KEY = "echoo_feature_voter_email";

export type WaitlistSessionSnapshot = {
  email: string;
  needsConfirmation: boolean;
  waitlistPosition: number | null;
  confirmationMailSent?: boolean;
  referralCode?: string | null;
};

export function readWaitlistSession(): WaitlistSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(WAITLIST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const email = typeof parsed.email === "string" ? parsed.email.trim().toLowerCase() : "";
    if (!email) return null;
    const rc = typeof parsed.referralCode === "string" ? parsed.referralCode.trim().toLowerCase() : null;
    return {
      email,
      needsConfirmation: Boolean(parsed.needsConfirmation),
      waitlistPosition:
        typeof parsed.waitlistPosition === "number" && Number.isFinite(parsed.waitlistPosition)
          ? parsed.waitlistPosition
          : null,
      confirmationMailSent: Boolean(parsed.confirmationMailSent),
      referralCode: rc && rc.length > 0 ? rc : null,
    };
  } catch {
    return null;
  }
}

export function persistWaitlistSession(snapshot: WaitlistSessionSnapshot): void {
  try {
    window.sessionStorage.setItem(
      WAITLIST_SESSION_KEY,
      JSON.stringify({
        email: snapshot.email.trim().toLowerCase(),
        needsConfirmation: snapshot.needsConfirmation,
        waitlistPosition: snapshot.waitlistPosition,
        confirmationMailSent: snapshot.confirmationMailSent ?? false,
        referralCode: snapshot.referralCode ?? null,
      }),
    );
  } catch {
    // ignore
  }
}

export function clearWaitlistSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(WAITLIST_SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Confirmed waitlist email + feature-requests access + gate-verified flag (same browser tab). */
export function persistConfirmedWaitlistEmail(email: string): void {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  try {
    window.sessionStorage.setItem(FEATURE_ACCESS_KEY, normalized);
    window.sessionStorage.setItem(FEATURE_VOTER_KEY, normalized);
    window.sessionStorage.setItem(WAITLIST_GATE_VERIFIED_KEY, normalized);
  } catch {
    // ignore
  }
}

export function clearConfirmedWaitlistEmail(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(FEATURE_ACCESS_KEY);
    window.sessionStorage.removeItem(FEATURE_VOTER_KEY);
    window.sessionStorage.removeItem(WAITLIST_GATE_VERIFIED_KEY);
  } catch {
    // ignore
  }
}

export const WAITLIST_REF_SESSION_KEY = "echoo_waitlist_ref";

/** Set when user proves waitlist email (join/confirm flow or "Show my stats"). */
export const REFERRAL_STATS_VERIFIED_EMAIL_KEY = "echoo_referral_stats_verified_email";

export function markReferralStatsVerifiedEmail(email: string): void {
  const n = email.trim().toLowerCase();
  if (!n) return;
  try {
    window.sessionStorage.setItem(REFERRAL_STATS_VERIFIED_EMAIL_KEY, n);
  } catch {
    // ignore
  }
}

export function clearReferralStatsVerifiedEmail(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(REFERRAL_STATS_VERIFIED_EMAIL_KEY);
  } catch {
    // ignore
  }
}

export function getReferralStatsVerifiedEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(REFERRAL_STATS_VERIFIED_EMAIL_KEY);
    return v?.trim().toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function isReferralStatsVerifiedForEmail(email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase() ?? "";
  if (!e) return false;
  const v = getReferralStatsVerifiedEmail();
  return Boolean(v && v === e);
}

/** Capture ?ref= from window search or hash query into session (8-char hex codes). */
export function captureReferralFromUrl(): void {
  if (typeof window === "undefined") return;
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(window.location.search).get("ref");
    if (!raw?.trim() && window.location.hash) {
      const qi = window.location.hash.indexOf("?");
      if (qi !== -1) {
        raw = new URLSearchParams(window.location.hash.slice(qi + 1)).get("ref");
      }
    }
  } catch {
    return;
  }
  const normalized = raw?.trim().toLowerCase().replace(/[^a-f0-9]/g, "") ?? "";
  if (normalized.length !== 8) return;
  try {
    window.sessionStorage.setItem(WAITLIST_REF_SESSION_KEY, normalized);
  } catch {
    // ignore
  }
}

export function getStoredReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(WAITLIST_REF_SESSION_KEY);
    return v && /^[a-f0-9]{8}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearStoredReferralCode(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(WAITLIST_REF_SESSION_KEY);
  } catch {
    // ignore
  }
}

export function buildWaitlistReferralShareUrl(refCode: string): string {
  if (typeof window === "undefined") return "";
  const code = refCode.trim().toLowerCase();
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/?ref=${encodeURIComponent(code)}`;
}

export function isWaitlistGateVerifiedForAccessEmail(accessEmail: string | null): boolean {
  if (!accessEmail?.trim()) return false;
  try {
    const verified = window.sessionStorage.getItem(WAITLIST_GATE_VERIFIED_KEY);
    const a = accessEmail.trim().toLowerCase();
    const v = verified?.trim().toLowerCase() ?? "";
    return Boolean(v && a === v);
  } catch {
    return false;
  }
}

/**
 * Normalized email already cleared for feature-requests (feature_access / voter / gate keys agree).
 */
export function getFeatureRequestsGateEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const access = window.sessionStorage.getItem(FEATURE_ACCESS_KEY)?.trim().toLowerCase() ?? "";
    if (access && isWaitlistGateVerifiedForAccessEmail(access)) return access;
    const voter = window.sessionStorage.getItem(FEATURE_VOTER_KEY)?.trim().toLowerCase() ?? "";
    if (voter && isWaitlistGateVerifiedForAccessEmail(voter)) return voter;
    const gate = window.sessionStorage.getItem(WAITLIST_GATE_VERIFIED_KEY)?.trim().toLowerCase() ?? "";
    if (gate && isWaitlistGateVerifiedForAccessEmail(gate)) return gate;
    return null;
  } catch {
    return null;
  }
}
