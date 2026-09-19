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

export type Role = "user" | "admin";

export interface User {
  id: string;
  /** Clerk's user id — the source of truth for identity; we never store a password or token ourselves. */
  clerkUserId: string;
  email: string;
  name?: string;
  role: Role;
  stripeCustomerId?: string;
  createdAt: string;
}

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export interface Subscription {
  id: string;
  userId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  role: string;
  seniority: Seniority;
  companyContext?: string;
  stressIntensity: StressIntensity;
  status: SessionStatus;
  /** Set once question generation completes; absent only in the brief window during session creation. */
  questionSetId?: string;
  /** Candidate-chosen target length for the whole session, set at schedule time. */
  scheduledDurationMinutes: number;
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
}

export interface DynamicFollowUp {
  triggerType: "live_interruption";
  text: string;
}

export interface Response {
  id: string;
  sessionId: string;
  questionId: string;
  transcript: string;
  createdAt: string;
  /**
   * Live pushback/interruptions the Interview Conductor injected mid-answer
   * (see gateway/sttGateway.ts), only for type=stress questions. Unlike the
   * data model sketch in docs/ARCHITECTURE.md §3, there's no separate
   * respondedTranscript per follow-up — the transcript stays continuous
   * through an interruption rather than being segmented, so only what was
   * said to the candidate is logged, not an isolated "response to it".
   */
  dynamicFollowUps?: DynamicFollowUp[];
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

export interface ComposureGrade {
  perStressQuestion: { questionId: string; recoveryScore: number; feedback: string }[];
  overallNarrative: string;
}

export interface TimeManagement {
  scheduledMinutes: number;
  /** Wall-clock time from session creation to Finish, in minutes. */
  actualMinutes: number;
  /**
   * Qualitative read on the variance — never a bare "ran over/under is bad"
   * verdict. Good interviews often run long because thorough answers take
   * longer; the assessment should judge whether the extra or saved time
   * correlated with answer depth/quality, not treat the raw delta as a
   * score by itself.
   */
  assessment: string;
}

export interface ImprovementPlan {
  /** 3-5 concrete, specific practice actions tied to what actually happened this session. */
  focusAreas: string[];
  /** 1-2 sentences recommending what kind of session to schedule next. */
  suggestedNextSessionFocus: string;
}

export interface GradingResult {
  id: string;
  sessionId: string;
  generatedAt: string;
  perQuestion: PerQuestionGrade[];
  /** Present only when the candidate gave recording consent and at least one frame was captured. */
  presentation?: PresentationGrade;
  /** Present only when at least one live interruption actually fired during the session. */
  composureUnderStress?: ComposureGrade;
  timeManagement: TimeManagement;
  overallScore: number; // 0-100
  overallSummary: string;
  topStrengths: string[];
  topGrowthAreas: string[];
  /** Present only for an active Premium subscriber at grading time — see services/grading/improvementPlan.ts. */
  improvementPlan?: ImprovementPlan;
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
