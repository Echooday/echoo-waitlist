/**
 * Opt-in waitlist diagnostics (never logs full tokens).
 *
 * Enable:
 * - Vite dev server (`import.meta.env.DEV`)
 * - URL: `?debugWaitlist=1` or `#/confirm?token=…&debugWaitlist=1`
 * - `localStorage.setItem("echoo_waitlist_debug", "1")`
 */
export function isWaitlistDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage?.getItem("echoo_waitlist_debug") === "1") return true;
    const q = new URLSearchParams(window.location.search).get("debugWaitlist");
    if (q === "1" || /^true$/i.test(q ?? "")) return true;
    const hash = window.location.hash ?? "";
    const qi = hash.indexOf("?");
    if (qi !== -1) {
      const hq = new URLSearchParams(hash.slice(qi + 1)).get("debugWaitlist");
      if (hq === "1" || /^true$/i.test(hq ?? "")) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function maskWaitlistToken(token: string): string {
  const t = token.trim();
  if (t.length <= 8) return `[len=${t.length}]`;
  return `${t.slice(0, 4)}…${t.slice(-4)} (len=${t.length})`;
}

export function waitlistDebug(label: string, payload: Record<string, unknown>): void {
  if (!isWaitlistDebugEnabled()) return;
  console.info(`[echoo waitlist] ${label}`, payload);
}
