import { useCallback, useEffect, useId, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildWaitlistReferralShareUrl,
  clearConfirmedWaitlistEmail,
  clearReferralStatsVerifiedEmail,
  isReferralStatsVerifiedForEmail,
  markReferralStatsVerifiedEmail,
  persistConfirmedWaitlistEmail,
} from "./waitlist-session";
import { track } from "./analytics";

export type DashboardStats = {
  invited_count: number;
  confirmed_count: number;
  registered_count: number;
  rewarded_referrals: number;
  months_granted_total: number;
  referral_code: string | null;
  waitlist_order: number | null;
  leaderboard_rank: number | null;
  leaderboard_size: number | null;
  total_confirmed_waitlist: number | null;
};

/** @deprecated Use DashboardStats; kept for any external imports */
export type PipelineStats = DashboardStats;

function referralMonthsFromQualifiedCount(qualifiedCount: number): number {
  const safeCount = Math.max(0, Math.floor(qualifiedCount));
  const firstSix = Math.min(6, safeCount) * 2;
  const afterSix = Math.max(0, safeCount - 6);
  return Math.min(24, firstSix + afterSix);
}

function numFromRpc(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function optNumFromRpc(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** PostgREST uses snake_case; tolerate a few alternate shapes if proxies change keys. */
function rpcWaitlistOrder(row: Record<string, unknown>): unknown {
  return row.waitlist_order ?? row.waitlistOrder;
}

function rpcTotalConfirmed(row: Record<string, unknown>): unknown {
  return row.total_confirmed_waitlist ?? row.totalConfirmedWaitlist;
}

/** Supabase usually returns an array of rows; tolerate a single object. */
function normalizeRpcRows(data: unknown): Record<string, unknown>[] {
  if (data == null) return [];
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === "object") return [data as Record<string, unknown>];
  return [];
}

/**
 * `referral_my_dashboard_stats` returns one all-zero row when the email is not a confirmed waitlist user.
 * Real rows always include a positive global `total_confirmed_waitlist` once the user exists in the DB.
 */
function isDashboardAbsentSentinel(row: Record<string, unknown>): boolean {
  const total = optNumFromRpc(rpcTotalConfirmed(row));
  if (total != null && total > 0) return false;
  const noCode = row.referral_code == null || String(row.referral_code).trim() === "";
  const noOrder = optNumFromRpc(rpcWaitlistOrder(row)) === null;
  const allZero =
    numFromRpc(row.invited_count) === 0 &&
    numFromRpc(row.confirmed_count) === 0 &&
    numFromRpc(row.registered_count) === 0 &&
    numFromRpc(row.rewarded_referrals) === 0 &&
    numFromRpc(row.months_granted_total) === 0;
  return noCode && noOrder && allZero;
}

export function ReferralInviteCard({
  referralCode,
  title = "Referral link",
}: {
  referralCode: string | null | undefined;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const url = referralCode ? buildWaitlistReferralShareUrl(referralCode) : "";

  const copy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track("referral_link_copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [url]);

  if (!referralCode?.trim()) return null;

  return (
    <div className="referral-invite-card">
      <h4 className="referral-invite-title">{title}</h4>
      <div className="referral-link-row">
        <code className="referral-link-url">{url || "—"}</code>
        <button type="button" className="referral-copy-btn" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

function PremiumMonthsExplainModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="referral-info-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="referral-info-modal"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="referral-info-modal-head">
          <h3 id={titleId} className="referral-info-modal-title">
            Referral premium (24&nbsp;months max)
          </h3>
          <button type="button" className="referral-info-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="referral-info-modal-body">
          <p>
            You earn premium months when people use your invite link, confirm their waitlist email, and then sign
            up in the Echoo app.
          </p>
          <ul>
            <li>
              <strong>First 6</strong> qualifying referrals: <strong>2 months</strong> each .
            </li>
            <li>
              <strong>After that:</strong> <strong>1 month</strong> per qualifying referral.
            </li>
            <li>
              <strong>Total cap:</strong> <strong>24 months</strong> of referral premium for this program.
            </li>
          </ul>
          <p className="referral-info-modal-note">
            A referral counts only when your invitee reaches <strong>registered</strong> in the app; if friends stay on
            the waitlist only, no premium is granted yet. Each person can only grant the reward once.
          </p>
        </div>
      </div>
    </div>
  );
}

function LeaveWaitlistConfirmModal({
  open,
  leaving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  leaving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !leaving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leaving, onClose, open]);

  if (!open) return null;

  return (
    <div
      className="referral-info-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!leaving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="referral-info-modal referral-leave-modal"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="referral-info-modal-head">
          <h3 id={titleId} className="referral-info-modal-title">
            Leave waitlist?
          </h3>
          <button
            type="button"
            className="referral-info-modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={leaving}
          >
            ×
          </button>
        </div>
        <div className="referral-info-modal-body">
          <p>If you leave now, your referral stats and referral progress in this waitlist program will expire.</p>
          <p className="referral-info-modal-note">
            You can still join again later, but previous referral progress will not be restored.
          </p>
          <div className="referral-leave-actions">
            <button type="button" className="referral-leave-cancel-btn" onClick={onClose} disabled={leaving}>
              Keep my spot
            </button>
            <button type="button" className="referral-leave-confirm-btn" onClick={onConfirm} disabled={leaving}>
              {leaving ? (
                <span className="btn-loading-content">
                  <span className="ui-spinner ui-spinner--btn" aria-hidden />
                  <span>Leaving…</span>
                </span>
              ) : (
                "Leave waitlist"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReferralPipelineStatsInner({
  supabase,
  email,
  referralCodeOverride,
}: {
  supabase: SupabaseClient;
  email: string;
  referralCodeOverride?: string | null;
}) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [premiumInfoOpen, setPremiumInfoOpen] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        let row: Record<string, unknown> | null = null;
        const dash = await supabase.rpc("referral_my_dashboard_stats", { p_email: e });
        if (!cancelled && !dash.error) {
          const dashRows = normalizeRpcRows(dash.data);
          const first = dashRows[0];
          if (first && !isDashboardAbsentSentinel(first)) {
            row = first;
          }
        }
        if (!cancelled && !row) {
          const pipe = await supabase.rpc("referral_pipeline_stats", { p_email: e });
          if (!pipe.error) {
            const pipeRows = normalizeRpcRows(pipe.data);
            const raw = pipeRows[0];
            if (raw) {
              row = {
                ...raw,
                leaderboard_rank: null,
                leaderboard_size: null,
              };
            }
          }
        }
        if (cancelled || !row) {
          setStats(null);
          return;
        }
        if (isDashboardAbsentSentinel(row)) {
          setStats(null);
          return;
        }
        const orderFromRpc = optNumFromRpc(rpcWaitlistOrder(row));
        const totalFromRpc = optNumFromRpc(rpcTotalConfirmed(row));
        setStats({
          invited_count: numFromRpc(row.invited_count),
          confirmed_count: numFromRpc(row.confirmed_count),
          registered_count: numFromRpc(row.registered_count),
          rewarded_referrals: numFromRpc(row.rewarded_referrals),
          months_granted_total: numFromRpc(row.months_granted_total),
          referral_code:
            typeof row.referral_code === "string" ? row.referral_code : null,
          waitlist_order: orderFromRpc,
          leaderboard_rank: optNumFromRpc(row.leaderboard_rank),
          leaderboard_size: optNumFromRpc(row.leaderboard_size),
          total_confirmed_waitlist: totalFromRpc,
        });
        track("referral_dashboard_loaded", {
          confirmed_count: numFromRpc(row.confirmed_count),
          registered_count: numFromRpc(row.registered_count),
          rewarded_referrals: numFromRpc(row.rewarded_referrals),
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email, retryNonce, supabase]);

  const code = referralCodeOverride ?? stats?.referral_code ?? null;
  const potentialMonths = stats
    ? Math.max(
        stats.months_granted_total,
        referralMonthsFromQualifiedCount(stats.confirmed_count),
      )
    : 0;
  const potentialMonthsCapped = Math.min(24, potentialMonths);

  return (
    <div className="referral-pipeline-card">
      {loading ? (
        <p className="referral-pipeline-loading" role="status">
          <span className="ui-spinner ui-spinner--btn" aria-hidden />
          Loading…
        </p>
      ) : stats ? (
        <>
          <dl className="referral-your-stats-summary">
            <div className="referral-your-stats-summary-row">
              <dt>Your place in the waitlist</dt>
              <dd className="tabular-nums">
                {stats.waitlist_order != null && stats.total_confirmed_waitlist != null
                  ? `${stats.waitlist_order} / ${stats.total_confirmed_waitlist}`
                  : "—"}
              </dd>
            </div>
          </dl>
          <div className="referral-stats-bento" aria-label="Referral funnel counts">
            <div className="referral-stat-tile">
              <span className="referral-stat-value">{stats.confirmed_count}</span>
              <span className="referral-stat-label">Friends in waitlist</span>
            </div>
            <div className="referral-stat-tile">
              <span className="referral-stat-value">{stats.registered_count}</span>
              <span className="referral-stat-label">In app</span>
            </div>
          </div>
          <div className="referral-premium">
            <div className="referral-premium-head">
              <span className="referral-premium-label-wrap">
                <span className="referral-premium-label">Potential pro months earned</span>
                <button
                  type="button"
                  className="referral-premium-info-btn"
                  aria-label="How referral premium months work"
                  title="How it works"
                  onClick={() => setPremiumInfoOpen(true)}
                >
                  <span className="referral-premium-info-icon" aria-hidden="true">
                    i
                  </span>
                </button>
              </span>
              <span className="referral-premium-fraction">
                <span className="tabular-nums">{potentialMonths}</span>
                <span className="referral-premium-cap"> / 24 mo</span>
              </span>
            </div>
            <progress
              className="referral-premium-progress"
              value={potentialMonthsCapped}
              max={24}
              aria-valuetext={`${potentialMonths} of 24 months potential`}
              aria-label={`${potentialMonths} of 24 premium months potential`}
            />
            <PremiumMonthsExplainModal open={premiumInfoOpen} onClose={() => setPremiumInfoOpen(false)} />
          </div>
        </>
      ) : (
        <div className="referral-pipeline-empty">
          <p>Could not load stats.</p>
          <button
            type="button"
            className="referral-stats-gate-btn"
            onClick={() => setRetryNonce((prev) => prev + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <ReferralInviteCard referralCode={code} />
    </div>
  );
}

/**
 * Personal stats (card) + invite: requires verified waitlist email, or ?ref= invite-only.
 */
export function ReferralPersonalDashboard({
  supabase,
  emailGuess,
  referralCodeOverride,
  onResetLanding,
}: {
  supabase: SupabaseClient;
  emailGuess: string | null | undefined;
  referralCodeOverride?: string | null;
  onResetLanding?: () => void;
}) {
  const [inputEmail, setInputEmail] = useState(() => emailGuess?.trim().toLowerCase() ?? "");
  const [busy, setBusy] = useState(false);
  const [gateError, setGateError] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [unlockedEmail, setUnlockedEmail] = useState<string | null>(() => {
    const g = emailGuess?.trim().toLowerCase() ?? "";
    return g && isReferralStatsVerifiedForEmail(g) ? g : null;
  });

  useEffect(() => {
    const g = emailGuess?.trim().toLowerCase() ?? "";
    const timer = window.setTimeout(() => {
      if (g) setInputEmail(g);
      if (g && isReferralStatsVerifiedForEmail(g)) {
        setUnlockedEmail(g);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [emailGuess]);

  const verify = useCallback(async () => {
    const e = inputEmail.trim().toLowerCase();
    if (!e) {
      setGateError("Please enter your waitlist email.");
      return;
    }
    setBusy(true);
    setGateError("");
    const { data, error } = await supabase.rpc("waitlist_email_exists", { p_email: e });
    setBusy(false);
    if (error) {
      if (/too many verification attempts/i.test(error.message ?? "")) {
        setGateError("Too many attempts. Please wait a few minutes and try again.");
        return;
      }
      setGateError("We could not verify this email right now. Please try again shortly.");
      return;
    }
    if (data !== true) {
      setGateError("We could not verify this email right now. Please try again shortly.");
      return;
    }
    markReferralStatsVerifiedEmail(e);
    persistConfirmedWaitlistEmail(e);
    setUnlockedEmail(e);
  }, [inputEmail, supabase]);

  const hasEmailGuess = Boolean(emailGuess?.trim());
  const showInviteOnly = Boolean(referralCodeOverride?.trim()) && !hasEmailGuess;
  const switchEmail = useCallback(() => {
    clearReferralStatsVerifiedEmail();
    clearConfirmedWaitlistEmail();
    if (onResetLanding) {
      onResetLanding();
      return;
    }
    setUnlockedEmail(null);
    setGateError("");
    setInputEmail("");
  }, [onResetLanding]);
  const leaveWaitlist = useCallback(async () => {
    if (!unlockedEmail || leaveLoading) return;
    setLeaveLoading(true);
    setGateError("");
    const { error } = await supabase.rpc("leave_waitlist", { p_email: unlockedEmail });
    setLeaveLoading(false);
    if (error) {
      const rpcMissing =
        error.code === "PGRST202" ||
        /leave_waitlist/i.test(error.message ?? "") ||
        /function.*does not exist/i.test(error.message ?? "");
      setGateError(
        rpcMissing
          ? "Leave waitlist is not enabled on this backend yet."
          : "Could not leave waitlist right now. Please try again.",
      );
      return;
    }
    setLeaveOpen(false);
    switchEmail();
  }, [leaveLoading, supabase, switchEmail, unlockedEmail]);

  return (
    <div className="referral-your-stats-card">
      <div className="referral-your-stats-head">
        <h3 className="referral-your-stats-card-title">Your stats</h3>
        {unlockedEmail ? (
          <div className="referral-stats-head-actions">
            <button type="button" className="referral-switch-email-btn" onClick={switchEmail}>
              Enter other email
            </button>
            <button type="button" className="referral-leave-btn" onClick={() => setLeaveOpen(true)}>
              Leave waitlist
            </button>
          </div>
        ) : null}
      </div>
      <div className="referral-personal-wrap">
        {showInviteOnly && !unlockedEmail ? (
          <ReferralInviteCard referralCode={referralCodeOverride} />
        ) : null}

        {unlockedEmail ? (
          <ReferralPipelineStatsInner
            supabase={supabase}
            email={unlockedEmail}
            referralCodeOverride={referralCodeOverride}
          />
        ) : !showInviteOnly ? (
          <div className="referral-stats-gate">
            <p className="referral-stats-gate-lead">Enter the email you confirmed on the waitlist.</p>
            <div className="referral-stats-gate-row">
              <input
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={inputEmail}
                onChange={(ev) => setInputEmail(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    void verify();
                  }
                }}
                disabled={busy}
              />
              <button type="button" className="referral-stats-gate-btn" onClick={() => void verify()} disabled={busy}>
                {busy ? (
                  <span className="btn-loading-content">
                    <span className="ui-spinner ui-spinner--btn" aria-hidden />
                    <span>Checking…</span>
                  </span>
                ) : (
                  "Continue"
                )}
              </button>
            </div>
            {gateError ? <p className="referral-stats-gate-error">{gateError}</p> : null}
          </div>
        ) : null}
      </div>
      <LeaveWaitlistConfirmModal
        open={leaveOpen}
        leaving={leaveLoading}
        onClose={() => setLeaveOpen(false)}
        onConfirm={() => void leaveWaitlist()}
      />
    </div>
  );
}
