import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSession, requestJobRole, searchJobRoles } from "../api/client";
import type { JobRole, Seniority, StressIntensity } from "../api/types";
import BillingPanel from "../components/BillingPanel";

const SENIORITIES: Seniority[] = ["junior", "mid", "senior", "staff", "exec"];
const STRESS_LEVELS: StressIntensity[] = ["low", "medium", "high"];
const DURATION_OPTIONS = [15, 30, 45, 60];
const SEARCH_DEBOUNCE_MS = 300;

export default function SchedulePage() {
  const navigate = useNavigate();

  // Role autocomplete state
  const [query, setQuery] = useState("");
  const [seniority, setSeniority] = useState<Seniority>("mid");
  const [suggestions, setSuggestions] = useState<JobRole[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<JobRole | null>(null);
  const [rejectedRationale, setRejectedRationale] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const [companyContext, setCompanyContext] = useState("");
  const [stressIntensity, setStressIntensity] = useState<StressIntensity>("medium");
  const [scheduledDurationMinutes, setScheduledDurationMinutes] = useState(30);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Re-searches whenever the typed text or seniority changes — a role is
  // seniority-specific (the same title can exist at one seniority and not
  // another), so switching seniority invalidates whatever was selected.
  useEffect(() => {
    setSelectedRole(null);
    setRejectedRationale(null);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchJobRoles(query.trim(), seniority)
        .then(({ roles }) => setSuggestions(roles))
        .catch(() => setSuggestions([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, seniority]);

  function onPickSuggestion(role: JobRole) {
    setSelectedRole(role);
    setQuery(role.title);
    setSuggestionsOpen(false);
  }

  async function onRequestRole() {
    const title = query.trim();
    if (!title) return;
    setRequesting(true);
    setError(null);
    setRejectedRationale(null);
    try {
      const { jobRole } = await requestJobRole(title, seniority);
      if (jobRole.status === "approved") {
        setSelectedRole(jobRole);
        setQuery(jobRole.title);
      } else {
        setRejectedRationale(jobRole.saturationRationale);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequesting(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedRole) return;
    setError(null);
    setLoading(true);
    try {
      const { session } = await createSession({
        jobRoleId: selectedRole.id,
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

  const readyNow = Boolean(selectedRole?.questionSetId);
  const submitLabel = loading
    ? "Scheduling…"
    : !selectedRole
      ? "Start mock interview"
      : readyNow
        ? "Start mock interview"
        : "Schedule — starts in 5 minutes";

  return (
    <div className="card">
      <BillingPanel />
      <h1>Schedule a mock interview</h1>
      <p className="muted">
        Pick the role and seniority you're targeting. Already-practiced roles start right away;
        a brand-new one goes through a quick automated check first.
      </p>
      <form onSubmit={onSubmit} className="form">
        <label className="role-autocomplete-label">
          Target role
          <div className="role-autocomplete">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
              placeholder="e.g. Senior Database Administrator"
              autoComplete="off"
              required
            />
            {suggestionsOpen && suggestions.length > 0 && (
              <ul className="role-suggestions">
                {suggestions.map((role) => (
                  <li key={role.id}>
                    <button type="button" onMouseDown={() => onPickSuggestion(role)}>
                      {role.title}
                      {role.usageCount > 0 && <span className="muted"> · practiced before</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </label>

        {!selectedRole && query.trim().length > 0 && !rejectedRationale && (
          <div className="role-request-prompt">
            <p className="muted">Didn't find "{query.trim()}"? We can check if it's worth adding.</p>
            <button type="button" className="secondary" onClick={onRequestRole} disabled={requesting}>
              {requesting ? "Checking…" : `Request "${query.trim()}"`}
            </button>
          </div>
        )}

        {rejectedRationale && (
          <p className="error role-rejected">
            "{query.trim()}" isn't supported yet: {rejectedRationale} Try rephrasing, or pick a
            close match from the suggestions above.
          </p>
        )}

        {selectedRole && !readyNow && (
          <p className="muted role-approved-note">
            "{selectedRole.title}" was just approved — scheduling it starts a 5-minute countdown
            while we prepare its questions for the first time. After that, it's instant for
            everyone (including you) from now on.
          </p>
        )}

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
        <p className="muted field-hint">
          Shown on your session for reference — the question set itself is shared across everyone
          practicing this role, so it isn't tailored to this.
        </p>

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

        <button type="submit" disabled={loading || !selectedRole}>
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
