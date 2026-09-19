import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getAdminExperiments, getAdminMetrics, getExperimentResults } from "../api/client";
import type { AdminMetrics, ExperimentResults } from "../api/types";
import { useAppUser } from "../hooks/useAppUser";

function formatCents(cents: number | undefined): string {
  if (cents === undefined) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatRate(conversions: number, exposures: number): string {
  if (exposures === 0) return "—";
  return `${((conversions / exposures) * 100).toFixed(1)}%`;
}

/** Read-only — same "metrics only" posture as the rest of this dashboard; there's nothing here to start, stop, or edit. */
function ExperimentResultsSection() {
  const [results, setResults] = useState<ExperimentResults[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminExperiments()
      .then(({ experiments }) => Promise.all(experiments.map((e) => getExperimentResults(e.key))))
      .then(setResults)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!results) return null;
  if (results.length === 0) return null;

  return (
    <section className="admin-experiments">
      <h2>A/B experiments</h2>
      {results.map((r) => {
        const goals = [...new Set(r.conversions.map((c) => c.goal))];
        return (
          <div className="admin-experiment-card" key={r.experimentKey}>
            <h3>{r.experimentKey}</h3>
            <p className="muted">{r.description}</p>
            <table className="admin-experiment-table">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Exposures</th>
                  {goals.map((g) => (
                    <th key={g}>{g}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.variants.map((variant) => {
                  const exposures = r.exposures[variant] ?? 0;
                  return (
                    <tr key={variant}>
                      <td>{variant}</td>
                      <td>{exposures}</td>
                      {goals.map((g) => {
                        const count = r.conversions.find((c) => c.variant === variant && c.goal === g)?.count ?? 0;
                        return (
                          <td key={g}>
                            {count} ({formatRate(count, exposures)})
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}

export default function AdminPage() {
  const { user, loading: userLoading } = useAppUser();
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== "admin") return;
    getAdminMetrics()
      .then(setMetrics)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [user]);

  if (userLoading) return null;
  // Same "just act like the route doesn't exist" posture as the backend's
  // 404-not-403 on /api/admin/* for non-admins.
  if (!user || user.role !== "admin") return <Navigate to="/" replace />;

  return (
    <div className="card">
      <h1>Admin — revenue &amp; usage</h1>
      <p className="muted">
        Metrics only. Managing individual users' subscriptions or comps isn't part of this
        dashboard — use the Stripe dashboard directly for that.
      </p>

      {error && <p className="error">{error}</p>}

      {metrics && (
        <div className="admin-metrics-grid">
          <div className="admin-metric">
            <span className="admin-metric-value">{formatCents(metrics.mrrCents)}</span>
            <span className="admin-metric-label">MRR</span>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-value">{metrics.activeSubscriberCount}</span>
            <span className="admin-metric-label">Active subscribers</span>
          </div>
          {Object.entries(metrics.subscribersByPlan).map(([planId, count]) => (
            <div className="admin-metric" key={planId}>
              <span className="admin-metric-value">{count}</span>
              <span className="admin-metric-label">{planId} subscribers</span>
            </div>
          ))}
          <div className="admin-metric">
            <span className="admin-metric-value">{metrics.totalUsers}</span>
            <span className="admin-metric-label">Total users</span>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-value">{metrics.freeUserCount}</span>
            <span className="admin-metric-label">Free users</span>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-value">{metrics.sessionsThisMonth}</span>
            <span className="admin-metric-label">Sessions this month</span>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-value">{metrics.sessionsAllTime}</span>
            <span className="admin-metric-label">Sessions all-time</span>
          </div>
        </div>
      )}

      <ExperimentResultsSection />
    </div>
  );
}
