import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  getAdminBrandConfig,
  getAdminExperiments,
  getAdminMetrics,
  getCommunicationHistory,
  getCommunicationTemplates,
  getExperimentResults,
  seedCommunicationTemplates,
  sendCommunication,
  setAdminBrandOverride,
} from "../api/client";
import type {
  AdminBrandConfig,
  AdminMetrics,
  AudienceSelector,
  CommunicationChannel,
  CommunicationSend,
  CommunicationSendSummary,
  CommunicationTemplate,
  ExperimentResults,
} from "../api/types";
import { useAppUser } from "../hooks/useAppUser";
import { channelsForEvent, groupTemplatesByCategory } from "../utils/communications";

function formatCents(cents: number | undefined): string {
  if (cents === undefined) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatRate(conversions: number, exposures: number): string {
  if (exposures === 0) return "—";
  return `${((conversions / exposures) * 100).toFixed(1)}%`;
}

/**
 * Force which brand.config.json variant everyone sees, or hand the
 * decision back to the "brand-identity" experiment's per-visitor split.
 * A genuine write action — distinct from the rest of this dashboard's
 * metrics-only posture, same as the end-user communications section below
 * — see the scope note above adminRouter.get("/brand", ...) in admin.ts.
 * Live A/B results for this same experiment still show in
 * ExperimentResultsSection below, whether or not an override is active.
 */
function BrandIdentitySection() {
  const [config, setConfig] = useState<AdminBrandConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function load() {
    getAdminBrandConfig()
      .then((c) => {
        setConfig(c);
        setSelected(c.overrideVariant ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(load, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await setAdminBrandOverride(selected || null);
      setSaved(true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!config) return null;

  return (
    <section className="admin-brand">
      <h2>Brand identity</h2>
      <p className="muted">
        Force one brand name/tagline for every visitor, or let the "brand-identity" experiment
        keep splitting traffic per visitor — see results below either way.
      </p>

      <div className="comms-variants">
        {config.variants.map((v) => (
          <div className="comms-variant-card" key={v.key}>
            <h3>{v.key}</h3>
            <p className="comms-variant-subject">{v.name}</p>
            <p className="comms-variant-body">
              {v.tagline}
              {"\n\n"}
              {v.description}
            </p>
          </div>
        ))}
      </div>

      <div className="comms-composer-row">
        <label>
          Show everyone
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setSaved(false);
            }}
          >
            <option value="">Let the experiment decide (current split)</option>
            {config.variants.map((v) => (
              <option value={v.key} key={v.key}>
                {v.name} ({v.key})
              </option>
            ))}
          </select>
        </label>
      </div>

      <button onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      {saved && (
        <p className="muted">
          {config.overrideVariant
            ? `Now forcing "${config.overrideVariant}" for everyone.`
            : "Now letting the experiment decide per visitor."}
        </p>
      )}
    </section>
  );
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

const CHANNEL_LABELS: Record<CommunicationChannel, string> = { email: "Email", sms: "SMS", push: "Push" };

/**
 * Compose/send templated, multi-channel, A/B-variant messages to end
 * users — a distinct, explicitly requested capability from the rest of
 * this dashboard's read-only metrics posture (see admin.ts). Templates are
 * seeded from a reference library grouped by lifecycle event (`typeName`)
 * x channel x variant; sending picks one (typeName, channel) pair and an
 * audience, and splits recipients across whatever variants exist for it.
 */
function CommunicationsSection() {
  const [templates, setTemplates] = useState<CommunicationTemplate[] | null>(null);
  const [channelStatus, setChannelStatus] = useState<Record<CommunicationChannel, boolean> | null>(null);
  const [history, setHistory] = useState<CommunicationSend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const [typeName, setTypeName] = useState("");
  const [channel, setChannel] = useState<CommunicationChannel>("email");
  const [audienceKind, setAudienceKind] = useState<AudienceSelector["kind"]>("all");
  const [audienceEmail, setAudienceEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSummary, setSendSummary] = useState<CommunicationSendSummary | null>(null);

  function loadAll() {
    Promise.all([getCommunicationTemplates(), getCommunicationHistory(50)])
      .then(([t, h]) => {
        setTemplates(t.templates);
        setChannelStatus(t.channelStatus);
        setHistory(h.sends);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(loadAll, []);

  // Lifecycle event -> category, and which channels have copy for it.
  const eventsByCategory = useMemo(() => groupTemplatesByCategory(templates ?? []), [templates]);

  useEffect(() => {
    if (typeName || !templates || templates.length === 0) return;
    setTypeName(templates[0].typeName);
    setChannel(templates[0].channel);
  }, [templates, typeName]);

  const variantsForSelection = useMemo(
    () => (templates ?? []).filter((t) => t.typeName === typeName && t.channel === channel),
    [templates, typeName, channel],
  );
  const availableChannels = useMemo(
    () => channelsForEvent(eventsByCategory, typeName),
    [eventsByCategory, typeName],
  );

  async function handleSeed() {
    setSeeding(true);
    setError(null);
    try {
      await seedCommunicationTemplates();
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    setSendSummary(null);
    try {
      const audience: AudienceSelector =
        audienceKind === "single" ? { kind: "single", email: audienceEmail } : { kind: audienceKind };
      const summary = await sendCommunication({ typeName, channel, audience });
      setSendSummary(summary);
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const historyByTemplateId = useMemo(() => new Map((templates ?? []).map((t) => [t.id, t])), [templates]);

  return (
    <section className="admin-communications">
      <h2>End-user communications</h2>
      <p className="muted">
        Compose and send templated, A/B-variant messages to end users across email/SMS/push. Copy comes
        from a seeded reference library of lifecycle communications — this doesn't touch individual
        accounts or billing.
      </p>

      {error && <p className="error">{error}</p>}

      {templates && templates.length === 0 && (
        <button onClick={handleSeed} disabled={seeding}>
          {seeding ? "Seeding…" : "Seed reference templates"}
        </button>
      )}

      {templates && templates.length > 0 && (
        <div className="comms-composer">
          <div className="comms-composer-row">
            <label>
              Lifecycle event
              <select
                value={typeName}
                onChange={(e) => {
                  setTypeName(e.target.value);
                  setSendSummary(null);
                }}
              >
                {[...eventsByCategory.entries()].map(([category, events]) => (
                  <optgroup label={category} key={category}>
                    {[...events.keys()].map((name) => (
                      <option value={name} key={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label>
              Channel
              <select
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value as CommunicationChannel);
                  setSendSummary(null);
                }}
              >
                {availableChannels.map((c) => (
                  <option value={c} key={c}>
                    {CHANNEL_LABELS[c]}
                    {channelStatus && !channelStatus[c] ? " (not configured — preview only)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="comms-variants">
            {variantsForSelection.map((t) => (
              <div className="comms-variant-card" key={t.id}>
                <h3>Variant {t.variant}</h3>
                {t.subject && <p className="comms-variant-subject">{t.subject}</p>}
                <p className="comms-variant-body">{t.body}</p>
                {t.variablesUsed.length > 0 && (
                  <p className="comms-variant-vars muted">Merge fields: {t.variablesUsed.join(", ")}</p>
                )}
              </div>
            ))}
            {variantsForSelection.length > 1 && (
              <p className="muted">
                Recipients are split deterministically across these {variantsForSelection.length} variants.
              </p>
            )}
          </div>

          <div className="comms-composer-row">
            <label>
              Audience
              <select
                value={audienceKind}
                onChange={(e) => setAudienceKind(e.target.value as AudienceSelector["kind"])}
              >
                <option value="all">All users</option>
                <option value="active_subscribers">Active subscribers</option>
                <option value="single">Single user (by email)</option>
              </select>
            </label>
            {audienceKind === "single" && (
              <label>
                Email
                <input
                  type="email"
                  value={audienceEmail}
                  onChange={(e) => setAudienceEmail(e.target.value)}
                  placeholder="user@example.com"
                />
              </label>
            )}
          </div>

          <button onClick={handleSend} disabled={sending || (audienceKind === "single" && !audienceEmail.trim())}>
            {sending ? "Sending…" : "Send"}
          </button>

          {sendSummary && (
            <div className="comms-send-summary">
              <p>
                Batch <code>{sendSummary.batchId}</code> — {sendSummary.results.length} recipient(s)
                {!sendSummary.configured && (
                  <span className="muted"> ({CHANNEL_LABELS[channel]} provider not configured — nothing was actually delivered)</span>
                )}
              </p>
              <ul className="comms-send-status-list">
                {(["sent", "skipped_no_provider", "failed"] as const).map((status) => {
                  const count = sendSummary.results.filter((r) => r.status === status).length;
                  if (count === 0) return null;
                  return (
                    <li key={status}>
                      {count} {status.replace(/_/g, " ")}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {history && history.length > 0 && (
        <div className="comms-history">
          <h3>Recent sends</h3>
          <table className="admin-experiment-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Channel</th>
                <th>Variant</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((send) => (
                <tr key={send.id}>
                  <td>{new Date(send.createdAt).toLocaleString()}</td>
                  <td>{historyByTemplateId.get(send.templateId)?.typeName ?? "—"}</td>
                  <td>{CHANNEL_LABELS[send.channel]}</td>
                  <td>{send.variant}</td>
                  <td>{send.status.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

      <BrandIdentitySection />
      <ExperimentResultsSection />
      <CommunicationsSection />
    </div>
  );
}
