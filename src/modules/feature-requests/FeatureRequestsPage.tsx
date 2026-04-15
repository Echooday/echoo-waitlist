import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Link, useSearchParams } from "react-router-dom";
import {
  isWaitlistGateVerifiedForAccessEmail,
  persistConfirmedWaitlistEmail,
} from "../../waitlist-session";
import { track } from "../../analytics";
import "./feature-requests.css";
import type {
  FeatureRequestRow,
  FeatureRequestVoteRow,
  SubmitterType,
} from "./types";

type Props = {
  supabase: SupabaseClient;
  source: "waitlist" | "app";
  currentUserId?: string | null;
  backTo?: string;
};

export function FeatureRequestsPage({
  supabase,
  source,
  currentUserId = null,
  backTo = "/",
}: Props) {
  const [searchParams] = useSearchParams();
  const urlEmailPrefillAttempted = useRef(false);
  const submitterType: SubmitterType = currentUserId ? "verified" : "unverified";
  const isVerifiedSession = !!currentUserId;
  const requiresWaitlistGate = source === "waitlist" && !isVerifiedSession;
  const [gateChecked, setGateChecked] = useState(() => {
    if (typeof window === "undefined") return true;
    if (!requiresWaitlistGate) return true;
    try {
      const access = window.sessionStorage.getItem("echoo_feature_access_email");
      const normalized = access?.trim() ? access.trim().toLowerCase() : null;
      return isWaitlistGateVerifiedForAccessEmail(normalized);
    } catch {
      return false;
    }
  });
  const [requests, setRequests] = useState<FeatureRequestRow[]>([]);
  const [voteMap, setVoteMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [votingState, setVotingState] = useState<{
    id: string;
    action: 1 | -1;
  } | null>(null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [gateEmailInput, setGateEmailInput] = useState("");
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState("");
  const [sessionVoterEmail, setSessionVoterEmail] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const voter = window.sessionStorage.getItem("echoo_feature_voter_email");
      if (voter?.trim()) return voter.trim().toLowerCase();
      const access = window.sessionStorage.getItem("echoo_feature_access_email");
      const a = access?.trim() ? access.trim().toLowerCase() : null;
      if (a && isWaitlistGateVerifiedForAccessEmail(a)) return a;
      return null;
    } catch {
      return null;
    }
  });
  const [accessEmail, setAccessEmail] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const value = window.sessionStorage.getItem("echoo_feature_access_email");
      return value?.trim() ? value.trim().toLowerCase() : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    track("funnel_feature_requests_viewed", {
      source,
      requires_waitlist_gate: requiresWaitlistGate,
      is_verified_session: isVerifiedSession,
    });
  }, [isVerifiedSession, requiresWaitlistGate, source]);

  const getVoterToken = useCallback(() => {
    const storageKey = "echoo_feature_voter_token";
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;

    const token = (() => {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
      if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      }
      return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    })();
    window.localStorage.setItem(storageKey, token);
    return token;
  }, []);

  const loadRequests = useCallback(async () => {
    if (!gateChecked) return;
    setLoading(true);
    const query = supabase
      .from("feature_requests")
      .select("id, title, content, vote_score, created_at, submitter_type")
      .eq("status", "open")
      .order("vote_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);

    const { data, error } = await query;
    if (error) {
      console.error("Error loading feature requests:", error);
      setMessage(`Could not load requests: ${error.message}`);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as FeatureRequestRow[];
    setRequests(rows);

    const ids = rows.map((row) => row.id);
    if (ids.length === 0) {
      setVoteMap({});
      setLoading(false);
      return;
    }

    let voteQuery = supabase
      .from("feature_request_votes")
      .select("id, feature_request_id, vote")
      .in("feature_request_id", ids);

    if (isVerifiedSession) {
      voteQuery = voteQuery.eq("created_by", currentUserId);
    } else if (sessionVoterEmail) {
      voteQuery = voteQuery.eq("contact_email", sessionVoterEmail);
    } else {
      setVoteMap({});
      setLoading(false);
      return;
    }

    const { data: votes, error: votesError } = await voteQuery;

    if (votesError) {
      console.error("Error loading votes:", votesError);
      setMessage(`Could not load your votes: ${votesError.message}`);
      setLoading(false);
      return;
    }

    const nextMap: Record<string, number> = {};
    for (const row of (votes ?? []) as FeatureRequestVoteRow[]) {
      nextMap[row.feature_request_id] = row.vote;
    }
    setVoteMap(nextMap);
    setLoading(false);
  }, [
    currentUserId,
    gateChecked,
    isVerifiedSession,
    sessionVoterEmail,
    supabase,
  ]);

  const refreshSingleRequestLazy = useCallback(
    (id: string) => {
      const run = async () => {
        const { data, error } = await supabase
          .from("feature_requests")
          .select("id, vote_score")
          .eq("id", id)
          .maybeSingle();
        if (error || !data) return;

        setRequests((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, vote_score: data.vote_score } : item,
          ),
        );
      };

      // Lazy sync during browser idle time; falls back to a short timeout.
      if ("requestIdleCallback" in window) {
        (
          window as typeof window & {
            requestIdleCallback: (
              callback: IdleRequestCallback,
              options?: IdleRequestOptions,
            ) => number;
          }
        ).requestIdleCallback(() => {
          run().catch(() => undefined);
        });
      } else {
        globalThis.setTimeout(() => {
          run().catch(() => undefined);
        }, 200);
      }
    },
    [supabase],
  );

  const verifyGateEmail = useCallback(
    async (rawEmail: string) => {
      const normalized = rawEmail.trim().toLowerCase();
      if (!normalized) {
        setGateError("Please enter the confirmed email address used for the waitlist.");
        track("feature_requests_gate_failed", { reason: "empty_email" });
        return;
      }

      setGateLoading(true);
      setGateError("");
      const { data, error } = await supabase.rpc("waitlist_email_exists", {
        p_email: normalized,
      });
      setGateLoading(false);

      if (error) {
        if (/too many verification attempts/i.test(error.message ?? "")) {
          setGateError("Too many attempts. Please wait a few minutes and try again.");
          track("feature_requests_gate_failed", { reason: "rate_limited" });
          return;
        }
        setGateError("We could not verify this email right now. Please try again shortly.");
        track("feature_requests_gate_failed", { reason: "verification_error" });
        return;
      }

      if (data !== true) {
        setGateError("We could not verify this email right now. Please try again shortly.");
        track("feature_requests_gate_failed", { reason: "not_verified" });
        return;
      }

      setAccessEmail(normalized);
      setSessionVoterEmail(normalized);
      setGateChecked(true);
      setMessage("");
      persistConfirmedWaitlistEmail(normalized);
      track("feature_requests_gate_passed");
    },
    [supabase],
  );

  useEffect(() => {
    if (requiresWaitlistGate && !gateChecked && !urlEmailPrefillAttempted.current) {
      const fromUrl = searchParams.get("email");
      if (fromUrl && fromUrl.trim()) {
        urlEmailPrefillAttempted.current = true;
        window.setTimeout(() => {
          verifyGateEmail(fromUrl).catch(() => undefined);
        }, 0);
        return;
      }
    }

    if (requiresWaitlistGate && !gateChecked && accessEmail) {
      window.setTimeout(() => {
        verifyGateEmail(accessEmail).catch(() => undefined);
      }, 0);
      return;
    }
    const timer = window.setTimeout(() => {
      loadRequests().catch((err) => console.error(err));
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    accessEmail,
    gateChecked,
    loadRequests,
    requiresWaitlistGate,
    searchParams,
    verifyGateEmail,
  ]);

  useEffect(() => {
    if (!requiresWaitlistGate || gateChecked) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [requiresWaitlistGate, gateChecked]);

  const shownRequests = useMemo(() => requests, [requests]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (!content.trim()) return;
    if (!isVerifiedSession && !accessEmail) {
      setMessage("Please use your confirmed waitlist email to continue.");
      return;
    }

    setSending(true);
    setMessage("");

    const { error } = await supabase.from("feature_requests").insert([
      {
        title: title.trim(),
        content: content.trim(),
        source,
        status: "open",
        submitter_type: submitterType,
        contact_email: submitterType === "unverified" ? accessEmail : null,
        created_by: submitterType === "verified" ? currentUserId : null,
      },
    ]);

    if (error) {
      console.error("Error creating feature request:", error);
      setMessage("Could not submit right now. Please try again.");
      track("feature_request_submit_failed");
      setSending(false);
      return;
    }

    setTitle("");
    setContent("");
    setMessage("Thanks. Your request is now in the dashboard.");
    track("feature_request_submitted", { source });
    await loadRequests();
    setSending(false);
  };

  const onVote = async (id: string, vote: 1 | -1) => {
    if (!isVerifiedSession && !sessionVoterEmail && !accessEmail) {
      setMessage("Please verify your waitlist email to vote.");
      return;
    }

    setVotingState({ id, action: vote });
    setMessage("");
    const token = getVoterToken();
    const currentVote = voteMap[id] ?? 0;
    const nextVote = currentVote === vote ? 0 : vote;
    const scoreDelta = nextVote - currentVote;
    const previousVoteMap = voteMap;
    const previousRequests = requests;

    // Optimistic state update: instant UI response without full refetch.
    setVoteMap((prev) => {
      if (nextVote === 0) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: nextVote };
    });
    setRequests((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, vote_score: item.vote_score + scoreDelta } : item,
      ),
    );

    if (nextVote === 0) {
      const { error } = await supabase
        .from("feature_request_votes")
        .delete()
        .eq("feature_request_id", id)
        .eq("voter_token", token);
      if (error) {
        console.error("Error deleting vote:", error);
        setMessage(`Voting failed: ${error.message}`);
        setVoteMap(previousVoteMap);
        setRequests(previousRequests);
        setVotingState(null);
        return;
      }
    } else {
      const { error } = await supabase.from("feature_request_votes").upsert(
        [
          {
            feature_request_id: id,
            voter_token: token,
            vote: nextVote,
            created_by: isVerifiedSession ? currentUserId : null,
            contact_email: isVerifiedSession ? null : (sessionVoterEmail ?? accessEmail),
          },
        ],
        { onConflict: "feature_request_id,voter_token" },
      );
      if (error) {
        console.error("Error upserting vote:", error);
        setMessage(`Voting failed: ${error.message}`);
        setVoteMap(previousVoteMap);
        setRequests(previousRequests);
        setVotingState(null);
        return;
      }
    }

    refreshSingleRequestLazy(id);
    setVotingState(null);
  };

  const gateModal =
    requiresWaitlistGate && !gateChecked ? (
      <div
        className="fr-gate-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fr-gate-title"
      >
        <div className="fr-gate-card">
          <h3 id="fr-gate-title">Access Feature Requests</h3>
          <p>
            Please enter the same email address that is already confirmed on the waitlist.
          </p>
          <input
            type="email"
            placeholder="Email"
            value={gateEmailInput}
            disabled={gateLoading}
            onChange={(e) => setGateEmailInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                verifyGateEmail(gateEmailInput).catch(() => undefined);
              }
            }}
          />
          <button
            type="button"
            onClick={() => verifyGateEmail(gateEmailInput).catch(() => undefined)}
            disabled={gateLoading}
          >
            {gateLoading ? (
              <span className="btn-loading-content">
                <span className="ui-spinner ui-spinner--btn" aria-hidden />
                <span>Verifying…</span>
              </span>
            ) : (
              "Continue"
            )}
          </button>
          {gateError ? <p className="fr-gate-error">{gateError}</p> : null}
        </div>
      </div>
    ) : null;

  return (
    <div className="app-container">
      {gateModal ? createPortal(gateModal, document.body) : null}
      <main className="page">
        <section className="page-section page-section--hero">
          <div className="page-section__inner page-section__inner--wide">
            <div className="fr-page">
              <div className="fr-header">
                <Link to={backTo} className="fr-back">
                  ← Back
                </Link>
                <h2>Feature requests</h2>
              </div>


              <section className="fr-section-card">
                <h3 className="fr-section-title">Hand in your feature request</h3>
                <p className="fr-section-subtitle">
                  Share one concrete idea. Clear titles and short, specific details are easier for others to vote on.
                </p>
                <form className="fr-form" onSubmit={onSubmit}>
                  <input
                    type="text"
                    placeholder="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    minLength={3}
                    maxLength={90}
                    required
                  />
                  <textarea
                    placeholder="Details"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    minLength={8}
                    maxLength={4000}
                    required
                  />
                  <button type="submit" disabled={sending}>
                    {sending ? (
                      <span className="btn-loading-content">
                        <span className="ui-spinner ui-spinner--btn" aria-hidden />
                        <span>Sending…</span>
                      </span>
                    ) : (
                      "Submit"
                    )}
                  </button>
                  {message && <p className="fr-message">{message}</p>}
                </form>
              </section>

              <section className="fr-section-card fr-open-requests">
                <h3 className="fr-section-title">Open requests</h3>
                <div className="fr-list">
                  {loading ? (
                    <p className="fr-loading-row" role="status">
                      <span className="ui-spinner ui-spinner--btn" aria-hidden />
                      <span>Loading…</span>
                    </p>
                  ) : shownRequests.length === 0 ? (
                    <p className="fr-empty">No requests yet.</p>
                  ) : (
                    shownRequests.map((item) => {
                      const ownVote = voteMap[item.id] ?? 0;
                      const rowVoting = votingState?.id === item.id;
                      const upLoading = rowVoting && votingState.action === 1;
                      const downLoading = rowVoting && votingState.action === -1;
                      return (
                        <article key={item.id} className="fr-item">
                          <div className="fr-item-main">
                            <h4 className="fr-item-title">{item.title}</h4>
                            <p>{item.content}</p>
                          </div>
                          <div className="fr-votes">
                            <button
                              type="button"
                              onClick={() => onVote(item.id, 1)}
                              className={ownVote === 1 ? "active" : ""}
                              aria-label="Upvote request"
                              disabled={rowVoting}
                            >
                              {upLoading ? (
                                <span className="ui-spinner ui-spinner--vote" aria-hidden />
                              ) : (
                                "▲"
                              )}
                            </button>
                            <span>{item.vote_score}</span>
                            <button
                              type="button"
                              onClick={() => onVote(item.id, -1)}
                              className={ownVote === -1 ? "active" : ""}
                              aria-label="Downvote request"
                              disabled={rowVoting}
                            >
                              {downLoading ? (
                                <span className="ui-spinner ui-spinner--vote" aria-hidden />
                              ) : (
                                "▼"
                              )}
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
        </div>
          </div>
        </section>
      </main>
    </div>
  );
}
