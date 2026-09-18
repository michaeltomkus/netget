import type {
  CandidateQuestion,
  GradingResult,
  ResponseRecord,
  Seniority,
  Session,
  StressIntensity,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Request to ${path} failed with ${res.status}`);
  }
  return body as T;
}

export function createSession(params: {
  role: string;
  seniority: Seniority;
  companyContext?: string;
  stressIntensity: StressIntensity;
}) {
  return request<{ session: Session; questions: CandidateQuestion[] }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function getSession(sessionId: string) {
  return request<{ session: Session; questions: CandidateQuestion[]; responses: ResponseRecord[] }>(
    `/api/sessions/${sessionId}`,
  );
}

export function submitResponse(sessionId: string, questionId: string, transcript: string) {
  return request<{ response: ResponseRecord }>(`/api/sessions/${sessionId}/responses`, {
    method: "POST",
    body: JSON.stringify({ questionId, transcript }),
  });
}

export function gradeSession(sessionId: string) {
  return request<{ result: GradingResult }>(`/api/sessions/${sessionId}/grade`, {
    method: "POST",
  });
}

export function getReport(sessionId: string) {
  return request<{
    session: Session;
    questions: CandidateQuestion[];
    responses: ResponseRecord[];
    result: GradingResult;
  }>(`/api/sessions/${sessionId}/report`);
}
