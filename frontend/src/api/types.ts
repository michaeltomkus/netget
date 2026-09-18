// Mirrors the candidate-facing subset of backend/src/types.ts. Kept separate
// (rather than shared via a workspace package) to keep Phase 1 scaffolding
// simple; worth promoting to a shared package if the schema grows.

export type Seniority = "junior" | "mid" | "senior" | "staff" | "exec";
export type StressIntensity = "low" | "medium" | "high";
export type QuestionType = "behavioral" | "technical" | "out_of_box" | "stress";
export type ExpectedStructure = "STAR" | "technical_walkthrough" | "open_ended";

export interface Session {
  id: string;
  createdAt: string;
  role: string;
  seniority: Seniority;
  companyContext?: string;
  stressIntensity: StressIntensity;
  status: string;
  questionSetId: string;
  recordingConsent: boolean;
}

export interface PresentationSignals {
  frameCount: number;
  faceDetectedRatio?: number;
  avgOffCenterRatio?: number;
  avgBrightness: number;
}

export interface CandidateQuestion {
  id: string;
  order: number;
  type: QuestionType;
  text: string;
  expectedStructure?: ExpectedStructure;
  /** Path (relative to API_BASE) to pre-synthesized TTS audio, if TTS is configured. */
  ttsAudioBlobRef?: string;
}

export interface ResponseRecord {
  id: string;
  sessionId: string;
  questionId: string;
  transcript: string;
  createdAt: string;
}

export interface PerQuestionGrade {
  questionId: string;
  contentScore: number;
  contentFeedback: string;
  structureScore: number;
  structureFeedback: string;
}

export interface PresentationGrade {
  attireScore: number;
  attireFeedback: string;
  framingLightingScore: number;
  framingLightingFeedback: string;
  eyeContactScore: number;
  eyeContactFeedback: string;
}

export interface GradingResult {
  id: string;
  sessionId: string;
  generatedAt: string;
  perQuestion: PerQuestionGrade[];
  presentation?: PresentationGrade;
  overallScore: number;
  overallSummary: string;
  topStrengths: string[];
  topGrowthAreas: string[];
}
