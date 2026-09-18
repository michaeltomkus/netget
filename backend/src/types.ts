// Data model, per docs/ARCHITECTURE.md §3.
// Phase 1 only exercises the fields relevant to a text-only, no-audio/video session;
// the rest of the shape is kept so later phases (audio, video, live nudges, stress
// tactics) slot in without a schema rewrite.

export type Seniority = "junior" | "mid" | "senior" | "staff" | "exec";
export type StressIntensity = "low" | "medium" | "high";
export type SessionStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "graded"
  | "abandoned";
export type QuestionType = "behavioral" | "technical" | "out_of_box" | "stress";
export type ExpectedStructure = "STAR" | "technical_walkthrough" | "open_ended";

export interface Session {
  id: string;
  createdAt: string;
  role: string;
  seniority: Seniority;
  companyContext?: string;
  stressIntensity: StressIntensity;
  status: SessionStatus;
  questionSetId: string;
  startedAt?: string;
  endedAt?: string;
  /** Explicit opt-in, captured at schedule time, before any camera access is requested. */
  recordingConsent: boolean;
  /**
   * Server-local disk paths to sampled presentation frames — never served
   * publicly, present only between "candidate submitted them at Finish" and
   * "grading pipeline deleted them after presentation grading" (see
   * gradingPipeline.ts). Never persisted past grading, per
   * docs/ARCHITECTURE.md §7 risk #1.
   */
  presentationFrameRefs?: string[];
  presentationSignals?: PresentationSignals;
}

/** Cheap, on-device-computed signals — never raw video — submitted alongside sampled frames. */
export interface PresentationSignals {
  frameCount: number;
  /** Fraction of sampled frames where a face was detected (0-1), or undefined if MediaPipe was unavailable. */
  faceDetectedRatio?: number;
  /** 0 (centered) to ~0.5+ (off to the side); rough nose-offset-from-bbox-center proxy, not true gaze tracking. */
  avgOffCenterRatio?: number;
  /** Average canvas pixel luminance, 0-255, as a coarse lighting-quality signal. */
  avgBrightness: number;
}

export interface Question {
  id: string;
  questionSetId: string;
  order: number;
  type: QuestionType;
  text: string;
  idealAnswerCriteria: string;
  expectedStructure?: ExpectedStructure;
  followUpTriggers?: string[];
  /** Public path (served under /media) to the pre-synthesized TTS audio for this question, if TTS is configured. */
  ttsAudioBlobRef?: string;
}

export interface QuestionSet {
  id: string;
  sessionId: string;
  questionIds: string[];
}

export interface Response {
  id: string;
  sessionId: string;
  questionId: string;
  transcript: string;
  createdAt: string;
}

export interface PerQuestionGrade {
  questionId: string;
  contentScore: number; // 0-100
  contentFeedback: string;
  structureScore: number; // 0-100
  structureFeedback: string;
}

export interface PresentationGrade {
  attireScore: number; // 0-100
  attireFeedback: string;
  framingLightingScore: number; // 0-100
  framingLightingFeedback: string;
  eyeContactScore: number; // 0-100
  eyeContactFeedback: string;
}

export interface GradingResult {
  id: string;
  sessionId: string;
  generatedAt: string;
  perQuestion: PerQuestionGrade[];
  /** Present only when the candidate gave recording consent and at least one frame was captured. */
  presentation?: PresentationGrade;
  overallScore: number; // 0-100
  overallSummary: string;
  topStrengths: string[];
  topGrowthAreas: string[];
}

// Payload shapes for question generation, exchanged with Claude via tool-use.

export interface GeneratedQuestion {
  type: QuestionType;
  text: string;
  idealAnswerCriteria: string;
  expectedStructure?: ExpectedStructure;
  followUpTriggers?: string[];
}

export interface GeneratedQuestionSet {
  questions: GeneratedQuestion[];
}
