import { useEffect, useState } from "react";
import { beginSession } from "../api/client";
import type { CandidateQuestion, Session } from "../api/types";

const POLL_INTERVAL_MS = 3000;

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Shown in place of the normal question UI while a session is "scheduled"
 * (a freshly-approved role's first-ever booking) — see routes/sessions.ts.
 * Counts down to scheduledFor, then polls POST /:id/begin, which 425s until
 * both the clock and background question generation are ready (in practice
 * generation finishes long before the countdown does).
 */
export default function ScheduledWaitRoom({
  session,
  onReady,
}: {
  session: Session;
  onReady: (session: Session, questions: CandidateQuestion[]) => void;
}) {
  const scheduledForMs = session.scheduledFor ? new Date(session.scheduledFor).getTime() : Date.now();
  const [now, setNow] = useState(Date.now());
  const [polling, setPolling] = useState(false);
  const [stillWaiting, setStillWaiting] = useState(false);

  const msRemaining = scheduledForMs - now;
  const countdownDone = msRemaining <= 0;

  useEffect(() => {
    if (countdownDone) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [countdownDone]);

  useEffect(() => {
    if (!countdownDone) return;
    let cancelled = false;
    setPolling(true);

    async function attempt() {
      try {
        const { session: started, questions } = await beginSession(session.id);
        if (!cancelled) onReady(started, questions);
      } catch {
        // A 425 ("too early" / "still preparing") is expected right around
        // the boundary, and any other failure here is just as safe to
        // retry — there's nothing destructive about calling begin again.
        if (!cancelled) {
          setStillWaiting(true);
          setTimeout(attempt, POLL_INTERVAL_MS);
        }
      }
    }
    void attempt();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownDone]);

  return (
    <div className="card wait-room">
      <h1>Get ready</h1>
      <p className="muted">
        "{session.role}" was just added — we're generating its question set now. This only
        happens once; every future candidate scheduling this role starts instantly.
      </p>
      {!countdownDone ? (
        <div className="wait-room-countdown">{formatCountdown(msRemaining)}</div>
      ) : (
        <p className="wait-room-status">
          {polling && stillWaiting ? "Still preparing — almost there…" : "Starting…"}
        </p>
      )}
    </div>
  );
}
