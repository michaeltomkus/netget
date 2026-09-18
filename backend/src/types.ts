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

export interface GradingResult {
  id: string;
  sessionId: string;
  generatedAt: string;
  perQuestion: PerQuestionGrade[];
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
