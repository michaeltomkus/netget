import type {
  AdminBrandConfig,
  AdminMetrics,
  AppUser,
  AudienceSelector,
  BillingInterval,
  BillingStatus,
  CandidateQuestion,
  CommunicationChannel,
  CommunicationSend,
  CommunicationSendSummary,
  CommunicationTemplate,
  DynamicFollowUp,
  ExperimentDefinition,
  ExperimentResults,
  GradingResult,
  JobRole,
  Plan,
  PresentationSignals,
  ResponseRecord,
  SchedulingInfo,
  Seniority,
  Session,
  SessionListItem,
  StressIntensity,
} from "./types";
import { getAuthToken } from "../auth/tokenBridge";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
export const WS_BASE = API_BASE.replace(/^http/, "ws");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers,
      ...init,
    });
  } catch {
    // fetch() throws for network-level failures (offline, DNS, connection
    // refused) rather than returning a response — distinguish that from a
    // normal HTTP error below so the message is actually actionable.
    throw new Error(
      typeof navigator !== "undefined" && !navigator.onLine
        ? "You're offline — check your connection and try again."
        : "Can't reach the server right now — check your connection and try again.",
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Request to ${path} failed with ${res.status}`);
  }
  return body as T;
}

export function createSession(params: {
  jobRoleId: string;
  companyContext?: string;
  stressIntensity: StressIntensity;
  recordingConsent: boolean;
  scheduledDurationMinutes: number;
}) {
  return request<{ session: Session; questions: CandidateQuestion[]; scheduling: SchedulingInfo }>(
    "/api/sessions",
    { method: "POST", body: JSON.stringify(params) },
  );
}

/** Transitions a "scheduled" (buffered) session into "in_progress" — see SessionPage's waiting room. */
export function beginSession(sessionId: string) {
  return request<{ session: Session; questions: CandidateQuestion[] }>(`/api/sessions/${sessionId}/begin`, {
    method: "POST",
  });
}

/** Autocomplete search — approved roles only, for the given seniority. An empty query returns that seniority's most-used roles. */
export function searchJobRoles(query: string, seniority: Seniority) {
  const params = new URLSearchParams({ seniority });
  if (query) params.set("q", query);
  return request<{ roles: JobRole[] }>(`/api/job-roles?${params.toString()}`);
}

/** Requests a role that didn't turn up in autocomplete — normalizes + scores it, approving or rejecting it. */
export function requestJobRole(title: string, seniority: Seniority) {
  return request<{ jobRole: JobRole }>("/api/job-roles/request", {
    method: "POST",
    body: JSON.stringify({ title, seniority }),
  });
}

export function getSessionHistory(params: { limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return request<{ sessions: SessionListItem[]; total: number; limit: number; offset: number }>(
    `/api/sessions${qs ? `?${qs}` : ""}`,
  );
}

export function getSession(sessionId: string) {
  return request<{ session: Session; questions: CandidateQuestion[]; responses: ResponseRecord[] }>(
    `/api/sessions/${sessionId}`,
  );
}

export function submitResponse(
  sessionId: string,
  questionId: string,
  transcript: string,
  dynamicFollowUps?: DynamicFollowUp[],
) {
  return request<{ response: ResponseRecord }>(`/api/sessions/${sessionId}/responses`, {
    method: "POST",
    body: JSON.stringify({ questionId, transcript, dynamicFollowUps }),
  });
}

export function submitPresentationData(
  sessionId: string,
  frames: string[],
  signals: PresentationSignals,
) {
  return request<{ ok: true; frameCount: number }>(`/api/sessions/${sessionId}/presentation`, {
    method: "POST",
    body: JSON.stringify({ frames, signals }),
  });
}

export function gradeSession(sessionId: string) {
  return request<{ result: GradingResult }>(`/api/sessions/${sessionId}/grade`, {
    method: "POST",
  });
}

export function getMe() {
  return request<{ user: AppUser }>("/api/me");
}

export function getAdminMetrics() {
  return request<AdminMetrics>("/api/admin/metrics");
}

export function getPlans() {
  // Deliberately the one billing endpoint that works signed-out — see
  // backend routes/billing.ts — so the landing page can show live pricing
  // before anyone signs in.
  return request<{ plans: Plan[]; freeSessionsPerMonth: number }>("/api/billing/plans");
}

export function getBillingStatus() {
  return request<BillingStatus>("/api/billing/status");
}

export function startCheckout(planId: string, interval: BillingInterval = "monthly") {
  return request<{ url: string }>("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ planId, interval }),
  });
}

export function openBillingPortal() {
  return request<{ url: string }>("/api/billing/portal", { method: "POST" });
}

export function exportAccountData() {
  // Loosely typed on purpose — this mirrors the raw stored shape (see
  // backend routes/me.ts), not the app's normal response types, since the
  // whole point is "everything, as stored."
  return request<Record<string, unknown>>("/api/me/export");
}

export function deleteAccount() {
  return request<{ ok: true }>("/api/me", { method: "DELETE" });
}

export function getReport(sessionId: string) {
  return request<{
    session: Session;
    questions: CandidateQuestion[];
    responses: ResponseRecord[];
    result: GradingResult;
  }>(`/api/sessions/${sessionId}/report`);
}

// A/B testing — see frontend/src/experiments/useExperiment.ts, the actual
// call site for these. Both work signed-out (no auth required server-side).

export function logExperimentExposure(experimentKey: string, variant: string, subjectId: string) {
  return request<void>("/api/experiments/exposure", {
    method: "POST",
    body: JSON.stringify({ experimentKey, variant, subjectId }),
  });
}

export function logExperimentConversion(experimentKey: string, variant: string, subjectId: string, goal: string) {
  return request<void>("/api/experiments/conversion", {
    method: "POST",
    body: JSON.stringify({ experimentKey, variant, subjectId, goal }),
  });
}

export function getAdminExperiments() {
  return request<{ experiments: ExperimentDefinition[] }>("/api/admin/experiments");
}

export function getExperimentResults(key: string) {
  return request<ExperimentResults>(`/api/admin/experiments/${key}/results`);
}

export function getCommunicationTemplates() {
  return request<{ templates: CommunicationTemplate[]; channelStatus: Record<CommunicationChannel, boolean> }>(
    "/api/admin/communications/templates",
  );
}

export function seedCommunicationTemplates() {
  return request<{ seeded: number }>("/api/admin/communications/templates/seed", { method: "POST" });
}

export function getCommunicationHistory(limit = 100) {
  return request<{ sends: CommunicationSend[] }>(`/api/admin/communications/history?limit=${limit}`);
}

export function getCommunicationVariantCounts(typeName: string, channel: CommunicationChannel) {
  return request<{ counts: { variant: string; status: string; count: number }[] }>(
    `/api/admin/communications/variant-counts?typeName=${encodeURIComponent(typeName)}&channel=${channel}`,
  );
}

export function sendCommunication(params: {
  typeName: string;
  channel: CommunicationChannel;
  audience: AudienceSelector;
  extraVars?: Record<string, string>;
}) {
  return request<CommunicationSendSummary>("/api/admin/communications/send", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// Public — read on every page load (see hooks/useBrand.ts), so this and
// getAdminBrandConfig deliberately stay separate: this one never requires
// auth even for a signed-out landing-page visitor.
export function getBrandOverride() {
  return request<{ overrideVariant: string | null }>("/api/brand/override");
}

export function getAdminBrandConfig() {
  return request<AdminBrandConfig>("/api/admin/brand");
}

export function setAdminBrandOverride(variantKey: string | null) {
  return request<{ overrideVariant: string | null }>("/api/admin/brand/override", {
    method: "POST",
    body: JSON.stringify({ variantKey }),
  });
}
