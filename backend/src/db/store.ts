import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import type {
  Session,
  QuestionSet,
  Question,
  Response,
  GradingResult,
  User,
  Subscription,
  PresentationSignals,
  DynamicFollowUp,
  PerQuestionGrade,
  PresentationGrade,
  ComposureGrade,
  TimeManagement,
  ImprovementPlan,
  SessionListItem,
} from "../types.js";

// Prisma-backed store, replacing the flat-JSON-file version used through
// Phase 6. Function names/shapes are kept close to the original so callers
// mostly just gained `await` — see git history for the JSON-file version if
// useful context. All functions are async now; Dates are converted to ISO
// strings and Json columns are cast to their app-level TS shape at the
// boundary, same pragmatic looseness (no runtime schema validation) as the
// original store had.

function toIso(d: Date | null | undefined): string | undefined {
  return d ? d.toISOString() : undefined;
}

// ---- Users ----

function mapUser(row: {
  id: string;
  clerkUserId: string;
  email: string;
  name: string | null;
  role: string;
  stripeCustomerId: string | null;
  createdAt: Date;
}): User {
  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    email: row.email,
    name: row.name ?? undefined,
    role: row.role as User["role"],
    stripeCustomerId: row.stripeCustomerId ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function upsertUserFromClerk(params: {
  clerkUserId: string;
  email: string;
  name?: string;
  /** If the email matches ADMIN_EMAILS, the caller passes role: "admin" so it sticks on first provisioning. */
  role?: User["role"];
}): Promise<User> {
  const row = await prisma.user.upsert({
    where: { clerkUserId: params.clerkUserId },
    update: { email: params.email, name: params.name },
    create: {
      clerkUserId: params.clerkUserId,
      email: params.email,
      name: params.name,
      role: params.role ?? "user",
    },
  });
  return mapUser(row);
}

export async function getUserById(id: string): Promise<User | undefined> {
  const row = await prisma.user.findUnique({ where: { id } });
  return row ? mapUser(row) : undefined;
}

export async function getUserByClerkId(clerkUserId: string): Promise<User | undefined> {
  const row = await prisma.user.findUnique({ where: { clerkUserId } });
  return row ? mapUser(row) : undefined;
}

export async function setUserStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId } });
}

export async function getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined> {
  const row = await prisma.user.findUnique({ where: { stripeCustomerId } });
  return row ? mapUser(row) : undefined;
}

export async function listUsers(): Promise<User[]> {
  const rows = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(mapUser);
}

export async function countUsers(): Promise<number> {
  return prisma.user.count();
}

// ---- Subscriptions ----

function mapSubscription(row: {
  id: string;
  userId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Subscription {
  return {
    id: row.id,
    userId: row.userId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    stripePriceId: row.stripePriceId,
    status: row.status as Subscription["status"],
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function upsertSubscriptionByStripeId(params: {
  userId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: Subscription["status"];
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}): Promise<Subscription> {
  const row = await prisma.subscription.upsert({
    where: { stripeSubscriptionId: params.stripeSubscriptionId },
    update: {
      status: params.status,
      stripePriceId: params.stripePriceId,
      currentPeriodEnd: new Date(params.currentPeriodEnd),
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    },
    create: {
      userId: params.userId,
      stripeSubscriptionId: params.stripeSubscriptionId,
      stripePriceId: params.stripePriceId,
      status: params.status,
      currentPeriodEnd: new Date(params.currentPeriodEnd),
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    },
  });
  return mapSubscription(row);
}

const ACTIVE_STATUSES: Subscription["status"][] = ["trialing", "active", "past_due"];

export async function getActiveSubscriptionForUser(userId: string): Promise<Subscription | undefined> {
  const row = await prisma.subscription.findFirst({
    where: { userId, status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  return row ? mapSubscription(row) : undefined;
}

export async function listActiveSubscriptions(): Promise<Subscription[]> {
  const rows = await prisma.subscription.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapSubscription);
}

// ---- Sessions ----

function mapSession(row: {
  id: string;
  userId: string;
  createdAt: Date;
  role: string;
  seniority: string;
  companyContext: string | null;
  stressIntensity: string;
  status: string;
  questionSetId: string | null;
  scheduledDurationMinutes: number;
  startedAt: Date | null;
  endedAt: Date | null;
  recordingConsent: boolean;
  presentationFrameRefs: string[];
  presentationSignals: unknown;
}): Session {
  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    role: row.role,
    seniority: row.seniority as Session["seniority"],
    companyContext: row.companyContext ?? undefined,
    stressIntensity: row.stressIntensity as Session["stressIntensity"],
    status: row.status as Session["status"],
    questionSetId: row.questionSetId ?? undefined,
    scheduledDurationMinutes: row.scheduledDurationMinutes,
    startedAt: toIso(row.startedAt),
    endedAt: toIso(row.endedAt),
    recordingConsent: row.recordingConsent,
    presentationFrameRefs: row.presentationFrameRefs.length ? row.presentationFrameRefs : undefined,
    presentationSignals: (row.presentationSignals as PresentationSignals | null) ?? undefined,
  };
}

export async function createSession(params: {
  userId: string;
  role: string;
  seniority: Session["seniority"];
  companyContext?: string;
  stressIntensity: Session["stressIntensity"];
  scheduledDurationMinutes: number;
}): Promise<Session> {
  const row = await prisma.session.create({
    data: {
      userId: params.userId,
      role: params.role,
      seniority: params.seniority,
      companyContext: params.companyContext,
      stressIntensity: params.stressIntensity,
      status: "in_progress",
      scheduledDurationMinutes: params.scheduledDurationMinutes,
      startedAt: new Date(),
      recordingConsent: false,
    },
  });
  return mapSession(row);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const row = await prisma.session.findUnique({ where: { id } });
  return row ? mapSession(row) : undefined;
}

export async function deleteSession(id: string): Promise<void> {
  // Compensating cleanup for a session that failed question generation right
  // after creation — see routes/sessions.ts. Cascades are not configured in
  // the schema (deliberately — losing a graded session by accident is worse
  // than a rare orphaned row), so related rows are removed explicitly here;
  // at this point in the flow none exist yet in practice.
  await prisma.session.delete({ where: { id } }).catch(() => {});
}

export async function updateSession(
  id: string,
  data: Partial<{
    status: Session["status"];
    questionSetId: string;
    endedAt: string;
    recordingConsent: boolean;
    presentationFrameRefs: string[] | null;
    presentationSignals: PresentationSignals | null;
  }>,
): Promise<Session> {
  const row = await prisma.session.update({
    where: { id },
    data: {
      status: data.status,
      questionSetId: data.questionSetId,
      endedAt: data.endedAt ? new Date(data.endedAt) : undefined,
      recordingConsent: data.recordingConsent,
      presentationFrameRefs:
        data.presentationFrameRefs === undefined
          ? undefined
          : (data.presentationFrameRefs ?? []),
      presentationSignals:
        data.presentationSignals === undefined
          ? undefined
          : data.presentationSignals === null
            ? Prisma.JsonNull
            : (data.presentationSignals as object),
    },
  });
  return mapSession(row);
}

/** Sessions created by this user since the given date — used for free-tier usage counting. */
export async function countSessionsSince(userId: string, since: Date): Promise<number> {
  return prisma.session.count({ where: { userId, createdAt: { gte: since } } });
}

/** Session history — newest first, with each session's overallScore (once graded) folded in so the list needs no follow-up query. */
export async function listSessionsForUser(
  userId: string,
  params: { limit: number; offset: number },
): Promise<{ sessions: SessionListItem[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: params.limit,
      skip: params.offset,
      select: {
        id: true,
        createdAt: true,
        role: true,
        seniority: true,
        stressIntensity: true,
        status: true,
        scheduledDurationMinutes: true,
        gradingResult: { select: { overallScore: true } },
      },
    }),
    prisma.session.count({ where: { userId } }),
  ]);

  const sessions: SessionListItem[] = rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    role: row.role,
    seniority: row.seniority as Session["seniority"],
    stressIntensity: row.stressIntensity as Session["stressIntensity"],
    status: row.status as Session["status"],
    scheduledDurationMinutes: row.scheduledDurationMinutes,
    overallScore: row.gradingResult?.overallScore,
  }));

  return { sessions, total };
}

export async function countAllSessions(): Promise<number> {
  return prisma.session.count();
}

export async function countSessionsSinceAllUsers(since: Date): Promise<number> {
  return prisma.session.count({ where: { createdAt: { gte: since } } });
}

// ---- Question sets & questions ----

export async function createQuestionSet(sessionId: string): Promise<QuestionSet> {
  const row = await prisma.questionSet.create({ data: { sessionId } });
  return { id: row.id, sessionId: row.sessionId };
}

function mapQuestion(row: {
  id: string;
  questionSetId: string;
  order: number;
  type: string;
  text: string;
  idealAnswerCriteria: string;
  expectedStructure: string | null;
  followUpTriggers: string[];
  ttsAudioBlobRef: string | null;
}): Question {
  return {
    id: row.id,
    questionSetId: row.questionSetId,
    order: row.order,
    type: row.type as Question["type"],
    text: row.text,
    idealAnswerCriteria: row.idealAnswerCriteria,
    expectedStructure: (row.expectedStructure as Question["expectedStructure"]) ?? undefined,
    followUpTriggers: row.followUpTriggers.length ? row.followUpTriggers : undefined,
    ttsAudioBlobRef: row.ttsAudioBlobRef ?? undefined,
  };
}

export async function saveQuestion(question: Question): Promise<void> {
  await prisma.question.upsert({
    where: { id: question.id },
    update: { ttsAudioBlobRef: question.ttsAudioBlobRef },
    create: {
      id: question.id,
      questionSetId: question.questionSetId,
      order: question.order,
      type: question.type,
      text: question.text,
      idealAnswerCriteria: question.idealAnswerCriteria,
      expectedStructure: question.expectedStructure,
      followUpTriggers: question.followUpTriggers ?? [],
      ttsAudioBlobRef: question.ttsAudioBlobRef,
    },
  });
}

export async function getQuestion(id: string): Promise<Question | undefined> {
  const row = await prisma.question.findUnique({ where: { id } });
  return row ? mapQuestion(row) : undefined;
}

export async function getQuestionsBySet(questionSetId: string): Promise<Question[]> {
  const rows = await prisma.question.findMany({
    where: { questionSetId },
    orderBy: { order: "asc" },
  });
  return rows.map(mapQuestion);
}

// ---- Responses ----

function mapResponse(row: {
  id: string;
  sessionId: string;
  questionId: string;
  transcript: string;
  createdAt: Date;
  dynamicFollowUps: unknown;
}): Response {
  return {
    id: row.id,
    sessionId: row.sessionId,
    questionId: row.questionId,
    transcript: row.transcript,
    createdAt: row.createdAt.toISOString(),
    dynamicFollowUps: (row.dynamicFollowUps as DynamicFollowUp[] | null) ?? undefined,
  };
}

export async function saveResponse(response: Response): Promise<void> {
  await prisma.response.create({
    data: {
      id: response.id,
      sessionId: response.sessionId,
      questionId: response.questionId,
      transcript: response.transcript,
      dynamicFollowUps: (response.dynamicFollowUps as object[] | undefined) ?? undefined,
    },
  });
}

export async function getResponsesBySession(sessionId: string): Promise<Response[]> {
  const rows = await prisma.response.findMany({ where: { sessionId } });
  return rows.map(mapResponse);
}

// ---- Grading results ----

function mapGradingResult(row: {
  id: string;
  sessionId: string;
  generatedAt: Date;
  perQuestion: unknown;
  presentation: unknown;
  composureUnderStress: unknown;
  timeManagement: unknown;
  overallScore: number;
  overallSummary: string;
  topStrengths: string[];
  topGrowthAreas: string[];
  improvementPlan: unknown;
}): GradingResult {
  return {
    id: row.id,
    sessionId: row.sessionId,
    generatedAt: row.generatedAt.toISOString(),
    perQuestion: row.perQuestion as PerQuestionGrade[],
    presentation: (row.presentation as PresentationGrade | null) ?? undefined,
    composureUnderStress: (row.composureUnderStress as ComposureGrade | null) ?? undefined,
    timeManagement: row.timeManagement as TimeManagement,
    overallScore: row.overallScore,
    overallSummary: row.overallSummary,
    topStrengths: row.topStrengths,
    topGrowthAreas: row.topGrowthAreas,
    improvementPlan: (row.improvementPlan as ImprovementPlan | null) ?? undefined,
  };
}

export async function saveGradingResult(result: GradingResult): Promise<void> {
  await prisma.gradingResult.create({
    data: {
      id: result.id,
      sessionId: result.sessionId,
      generatedAt: new Date(result.generatedAt),
      perQuestion: result.perQuestion as unknown as object,
      presentation: (result.presentation as unknown as object) ?? undefined,
      composureUnderStress: (result.composureUnderStress as unknown as object) ?? undefined,
      timeManagement: result.timeManagement as unknown as object,
      overallScore: result.overallScore,
      overallSummary: result.overallSummary,
      topStrengths: result.topStrengths,
      topGrowthAreas: result.topGrowthAreas,
      improvementPlan: (result.improvementPlan as unknown as object) ?? undefined,
    },
  });
}

export async function getGradingResultBySession(sessionId: string): Promise<GradingResult | undefined> {
  const row = await prisma.gradingResult.findUnique({ where: { sessionId } });
  return row ? mapGradingResult(row) : undefined;
}

// ---- Account export/delete ----

// Everything this app stores about one user, for the "download my data"
// endpoint (routes/me.ts). Raw Prisma rows, not re-mapped through the
// mapX() helpers above — res.json() already serializes Date via
// Date#toJSON(), and a data-export response is meant to be the actual
// stored shape, not the app-level view of it.
export async function getFullUserExport(userId: string) {
  const [user, sessions, subscriptions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        questionSet: { include: { questions: true } },
        responses: true,
        gradingResult: true,
      },
    }),
    prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);
  return { user, sessions, subscriptions };
}

// Deletes every row this user owns, in FK-safe order, inside one
// transaction — used by the account-deletion flow (routes/me.ts). Doesn't
// touch Stripe or Clerk; the caller cancels the subscription and deletes
// the Clerk identity itself, since those are separate systems this store
// doesn't own. Returns the caller's leftover presentation-frame file paths
// (normally already deleted by the grading pipeline — see services/media.ts
// — but an abandoned, never-graded session can still have some) so the
// caller can clean those up from disk too.
export async function deleteUserAndAllData(userId: string): Promise<{ presentationFrameRefs: string[] }> {
  const sessions = await prisma.session.findMany({
    where: { userId },
    select: { id: true, questionSetId: true, presentationFrameRefs: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  const questionSetIds = sessions.map((s) => s.questionSetId).filter((id): id is string => Boolean(id));
  const presentationFrameRefs = sessions.flatMap((s) => s.presentationFrameRefs);

  await prisma.$transaction([
    prisma.response.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.gradingResult.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.question.deleteMany({ where: { questionSetId: { in: questionSetIds } } }),
    prisma.questionSet.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.session.deleteMany({ where: { id: { in: sessionIds } } }),
    prisma.subscription.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  return { presentationFrameRefs };
}

// Kept as a namespace object too, for call sites that prefer `store.method()`
// over named imports — both work identically.
export const store = {
  upsertUserFromClerk,
  getUserById,
  getUserByClerkId,
  setUserStripeCustomerId,
  getUserByStripeCustomerId,
  listUsers,
  countUsers,
  upsertSubscriptionByStripeId,
  getActiveSubscriptionForUser,
  listActiveSubscriptions,
  createSession,
  getSession,
  deleteSession,
  updateSession,
  countSessionsSince,
  listSessionsForUser,
  countAllSessions,
  countSessionsSinceAllUsers,
  createQuestionSet,
  saveQuestion,
  getQuestion,
  getQuestionsBySet,
  saveResponse,
  getResponsesBySession,
  saveGradingResult,
  getGradingResultBySession,
  getFullUserExport,
  deleteUserAndAllData,
};
