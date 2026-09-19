import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getAdminMetrics } from "../api/client";
import type { AdminMetrics } from "../api/types";
import { useAppUser } from "../hooks/useAppUser";

function formatCents(cents: number | undefined): string {
  if (cents === undefined) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
    </div>
  );
}
