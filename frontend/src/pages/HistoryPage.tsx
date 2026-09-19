import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSessionHistory } from "../api/client";
import type { SessionListItem } from "../api/types";

const PAGE_SIZE = 20;

const SENIORITY_LABEL: Record<string, string> = {
  junior: "Junior",
  mid: "Mid",
  senior: "Senior",
  staff: "Staff",
  exec: "Executive",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  graded: "Graded",
  abandoned: "Abandoned",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// A compact, single-series trend line — no axes/gridlines/legend, per the
// house sparkline pattern: a stat-tile micro-viz, not a full chart. Each
// point keeps a native <title> as its hover affordance rather than a
// custom tooltip, which is enough for "how am I trending" at this scale.
function ScoreSparkline({ scores }: { scores: { date: string; score: number }[] }) {
  if (scores.length < 2) return null;

  const width = 240;
  const height = 48;
  const pad = 6;
  const max = 100;
  const min = 0;
  const stepX = (width - pad * 2) / (scores.length - 1);
  const points = scores.map((s, i) => ({
    x: pad + i * stepX,
    y: pad + (1 - (s.score - min) / (max - min)) * (height - pad * 2),
    ...s,
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", maxWidth: width, height: "auto", display: "block" }}
      role="img"
      aria-label={`Score trend across your last ${scores.length} graded sessions, from ${scores[0].score} to ${scores[scores.length - 1].score}`}
    >
      <path d={path} fill="none" stroke="var(--accent-2)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="var(--accent-2)">
          <title>
            {formatDate(p.date)}: {p.score}
          </title>
        </circle>
      ))}
    </svg>
  );
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSessionHistory({ limit: PAGE_SIZE, offset: 0 })
      .then((res) => {
        setSessions(res.sessions);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const res = await getSessionHistory({ limit: PAGE_SIZE, offset: sessions.length });
      setSessions((prev) => [...prev, ...res.sessions]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) return <div className="card">Loading history…</div>;

  const graded = sessions.filter((s) => s.overallScore !== undefined);
  const averageScore = graded.length
    ? Math.round(graded.reduce((sum, s) => sum + (s.overallScore ?? 0), 0) / graded.length)
    : undefined;
  // Chronological (oldest → newest) for the trend line — the list itself stays newest-first.
  const scoreTrend = [...graded]
    .reverse()
    .map((s) => ({ date: s.createdAt, score: s.overallScore! }));

  return (
    <div className="card">
      <h1>Your history</h1>
      <p className="muted">Every mock interview you've run, most recent first.</p>

      <div className="history-stats">
        <div className="history-stat">
          <span className="admin-metric-value">{total}</span>
          <span className="admin-metric-label">Total sessions</span>
        </div>
        <div className="history-stat">
          <span className="admin-metric-value">{averageScore ?? "—"}</span>
          <span className="admin-metric-label">Average score</span>
        </div>
        {scoreTrend.length >= 2 && (
          <div className="history-stat history-stat-trend">
            <ScoreSparkline scores={scoreTrend} />
            <span className="admin-metric-label">Score trend</span>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {sessions.length === 0 ? (
        <p className="muted">No sessions yet — schedule one from the home page to get started.</p>
      ) : (
        <div className="history-list">
          {sessions.map((s) => {
            const isGraded = s.status === "graded" && s.overallScore !== undefined;
            const href = isGraded ? `/session/${s.id}/report` : `/session/${s.id}`;
            return (
              <Link to={href} key={s.id} className="history-row">
                <div className="history-row-main">
                  <span className="history-row-role">{s.role}</span>
                  <span className="muted history-row-meta">
                    {SENIORITY_LABEL[s.seniority] ?? s.seniority} · {formatDate(s.createdAt)} ·{" "}
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </div>
                {isGraded ? (
                  <span className="history-row-score">{s.overallScore}</span>
                ) : (
                  <span className="muted history-row-resume">
                    {s.status === "in_progress" ? "Resume →" : "—"}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {sessions.length < total && (
        <button type="button" className="secondary" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : `Load more (${total - sessions.length} remaining)`}
        </button>
      )}
    </div>
  );
}
