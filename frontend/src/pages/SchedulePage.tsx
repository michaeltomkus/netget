import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSession } from "../api/client";
import type { Seniority, StressIntensity } from "../api/types";

const SENIORITIES: Seniority[] = ["junior", "mid", "senior", "staff", "exec"];
const STRESS_LEVELS: StressIntensity[] = ["low", "medium", "high"];
const DURATION_OPTIONS = [15, 30, 45, 60];

export default function SchedulePage() {
  const navigate = useNavigate();
  const [role, setRole] = useState("");
  const [seniority, setSeniority] = useState<Seniority>("mid");
  const [companyContext, setCompanyContext] = useState("");
  const [stressIntensity, setStressIntensity] = useState<StressIntensity>("medium");
  const [scheduledDurationMinutes, setScheduledDurationMinutes] = useState(30);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { session } = await createSession({
        role,
        seniority,
        companyContext: companyContext.trim() || undefined,
        stressIntensity,
        scheduledDurationMinutes,
        recordingConsent,
      });
      navigate(`/session/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h1>Schedule a mock interview</h1>
      <p className="muted">
        Pick the role and seniority you're targeting. Questions — including a couple of
        stress-test curveballs — are generated fresh for this session.
      </p>
      <form onSubmit={onSubmit} className="form">
        <label>
          Target role
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Senior Database Administrator"
            required
          />
        </label>

        <label>
          Seniority level
          <select value={seniority} onChange={(e) => setSeniority(e.target.value as Seniority)}>
            {SENIORITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label>
          Company / industry context (optional)
          <input
            value={companyContext}
            onChange={(e) => setCompanyContext(e.target.value)}
            placeholder="e.g. healthcare data platform, mid-size company"
          />
        </label>

        <label>
          Stress intensity
          <select
            value={stressIntensity}
            onChange={(e) => setStressIntensity(e.target.value as StressIntensity)}
          >
            {STRESS_LEVELS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label>
          Scheduled length
          <select
            value={scheduledDurationMinutes}
            onChange={(e) => setScheduledDurationMinutes(Number(e.target.value))}
          >
            {DURATION_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </label>
        <p className="muted field-hint">
          Your report notes how your actual time compared to this — running over isn't
          automatically bad, thorough answers often take longer.
        </p>

        <label className="consent-label">
          <input
            type="checkbox"
            checked={recordingConsent}
            onChange={(e) => setRecordingConsent(e.target.checked)}
          />
          <span>
            Use my camera during this session for presentation feedback (framing, attire, eye
            contact). Frames are analyzed right after the session and deleted immediately
            afterward — not stored. Optional; without this, you'll still get full content and
            delivery feedback.
          </span>
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={loading || !role.trim()}>
          {loading ? "Generating questions…" : "Start mock interview"}
        </button>
      </form>
    </div>
  );
}
