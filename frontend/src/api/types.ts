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
  jobRoleId?: string;
  questionSetId?: string;
  recordingConsent: boolean;
  scheduledDurationMinutes: number;
  startedAt?: string;
  /** Earliest moment a "scheduled" (buffered, freshly-approved-role) session may begin. */
  scheduledFor?: string;
}

export type JobRoleStatus = "approved" | "rejected";

/** A role-catalog entry — see backend/src/types.ts for the full lifecycle. */
export interface JobRole {
  id: string;
  title: string;
  seniority: Seniority;
  status: JobRoleStatus;
  saturationScore: number;
  saturationRationale: string;
  usageCount: number;
  /** Present once this role's cached question set exists — absent means "approved, generation still in flight." */
  questionSetId?: string;
}

/** How POST /api/sessions wants the caller to proceed. */
export type SchedulingInfo = { status: "ready" } | { status: "buffered"; scheduledFor: string };

export interface SessionListItem {
  id: string;
  createdAt: string;
  role: string;
  seniority: Seniority;
  stressIntensity: StressIntensity;
  status: string;
  scheduledDurationMinutes: number;
  overallScore?: number;
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

export interface DynamicFollowUp {
  triggerType: "live_interruption";
  text: string;
}

export interface ResponseRecord {
  id: string;
  sessionId: string;
  questionId: string;
  transcript: string;
  createdAt: string;
  dynamicFollowUps?: DynamicFollowUp[];
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

export interface ComposureGrade {
  perStressQuestion: { questionId: string; recoveryScore: number; feedback: string }[];
  overallNarrative: string;
}

export interface TimeManagement {
  scheduledMinutes: number;
  actualMinutes: number;
  assessment: string;
}

export interface ImprovementPlan {
  focusAreas: string[];
  suggestedNextSessionFocus: string;
}

export interface GradingResult {
  id: string;
  sessionId: string;
  generatedAt: string;
  perQuestion: PerQuestionGrade[];
  presentation?: PresentationGrade;
  composureUnderStress?: ComposureGrade;
  timeManagement: TimeManagement;
  overallScore: number;
  overallSummary: string;
  topStrengths: string[];
  topGrowthAreas: string[];
  /** Premium-plan-only — see backend services/grading/improvementPlan.ts. */
  improvementPlan?: ImprovementPlan;
}

export interface Subscription {
  id: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  amountCents: number | null;
  currency: string;
  interval?: string;
  /** Present only once an annual price is configured for this plan — see backend services/stripe.ts. */
  annual?: {
    amountCents: number | null;
    currency: string;
    interval?: string;
  };
  /** Set globally via STRIPE_TRIAL_PERIOD_DAYS — undefined/0 means no trial. */
  trialPeriodDays?: number;
}

export type BillingInterval = "monthly" | "annual";

export interface BillingStatus {
  stripeConfigured: boolean;
  subscription?: Subscription;
  /** The plan the caller's active subscription resolves to, if any. */
  plan?: { id: string; name: string; tagline: string };
  freeTier: { used: number; limit: number };
}

export interface AppUser {
  id: string;
  email: string;
  name?: string;
  role: "user" | "admin";
}

export interface AdminMetrics {
  totalUsers: number;
  activeSubscriberCount: number;
  freeUserCount: number;
  subscribersByPlan: Record<string, number>;
  sessionsThisMonth: number;
  sessionsAllTime: number;
  mrrCents?: number;
}
