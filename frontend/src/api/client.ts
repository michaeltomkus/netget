import type {
  CandidateQuestion,
  DynamicFollowUp,
  GradingResult,
  PresentationSignals,
  ResponseRecord,
  Seniority,
  Session,
  StressIntensity,
} from "./types";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
export const WS_BASE = API_BASE.replace(/^http/, "ws");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
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
  role: string;
  seniority: Seniority;
  companyContext?: string;
  stressIntensity: StressIntensity;
  recordingConsent: boolean;
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

export function getReport(sessionId: string) {
  return request<{
    session: Session;
    questions: CandidateQuestion[];
    responses: ResponseRecord[];
    result: GradingResult;
  }>(`/api/sessions/${sessionId}/report`);
}
