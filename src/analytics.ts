import posthog from "posthog-js";

const apiKey = import.meta.env.VITE_POSTHOG_API_KEY as string | undefined;
const host =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://eu.i.posthog.com";

/** Current storage key; legacy `memi_*` is still read once for migration. */
export const ANALYTICS_CONSENT_STORAGE_KEY = "echoo_analytics_consent_web";
const LEGACY_ANALYTICS_CONSENT_STORAGE_KEY = "memi_analytics_consent_web";

type EventProperties = Record<string, unknown>;

let consentEnabled = false;
let initialized = false;

function ensureClient() {
  if (!apiKey?.trim()) return;
  if (!consentEnabled || initialized) return;
  if (typeof window === "undefined") return;

  posthog.init(apiKey.trim(), {
    api_host: host.replace(/\/$/, ""),
    capture_pageview: false,
    persistence: "localStorage",
    autocapture: false,
    disable_session_recording: true,
  });
  initialized = true;
}

/** Call once on app load so direct hits to /#/confirm etc. still respect saved consent. */
export function hydrateAnalyticsConsentFromStorage() {
  if (typeof window === "undefined") return;
  try {
    let raw = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    if (raw === null) {
      raw = window.localStorage.getItem(LEGACY_ANALYTICS_CONSENT_STORAGE_KEY);
      if (raw === "1") {
        window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "1");
      } else if (raw === "0") {
        window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "0");
      }
    }
    if (raw === "1") setAnalyticsConsentWeb(true);
    else if (raw === "0") setAnalyticsConsentWeb(false);
  } catch {
    // ignore
  }
}

export function setAnalyticsConsentWeb(enabled: boolean) {
  consentEnabled = enabled;
  if (enabled) {
    ensureClient();
    if (initialized) posthog.opt_in_capturing();
  } else if (initialized) {
    posthog.opt_out_capturing();
    posthog.reset();
  }
}

/** PostHog `$pageview` for SPA / hash routes (we disable automatic pageviews in init). */
export function capturePageview() {
  if (!consentEnabled || !initialized) return;
  const safeUrl = (() => {
    try {
      const current = new URL(window.location.href);
      current.searchParams.delete("token");

      if (current.hash.includes("?")) {
        const [hashPath, hashQuery = ""] = current.hash.slice(1).split("?");
        const hashParams = new URLSearchParams(hashQuery);
        hashParams.delete("token");
        const nextHashQuery = hashParams.toString();
        current.hash = nextHashQuery ? `${hashPath}?${nextHashQuery}` : hashPath;
      }

      return current.toString();
    } catch {
      return window.location.origin + window.location.pathname;
    }
  })();

  posthog.capture("$pageview", {
    $current_url: safeUrl,
  });
}

export function track(event: string, properties?: EventProperties) {
  if (!consentEnabled || !initialized) return;
  posthog.capture(event, properties);
}

export function identify(distinctId: string, properties?: EventProperties) {
  if (!consentEnabled || !initialized) return;
  posthog.identify(distinctId, properties);
}

export function isPosthogConfigured(): boolean {
  return Boolean(apiKey?.trim());
}
