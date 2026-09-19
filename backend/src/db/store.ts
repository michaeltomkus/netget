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
  JobRole,
  BankQuestion,
  CommunicationTemplate,
  CommunicationSend,
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

/** Case-insensitive — mirrors how sign-in/checkout email matching already treats email as case-insensitive elsewhere in this app. */
export async function getUserByEmail(email: string): Promise<User | undefined> {
  const row = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  return row ? mapUser(row) : undefined;
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

/** Users with at least one active/trialing/past_due subscription — one filtered query instead of fetching every user and every subscription and intersecting them in JS. */
export async function listActiveSubscriberUsers(): Promise<User[]> {
  const rows = await prisma.user.findMany({
    where: { subscriptions: { some: { status: { in: ACTIVE_STATUSES } } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapUser);
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
  jobRoleId: string | null;
  questionSetId: string | null;
  scheduledDurationMinutes: number;
  startedAt: Date | null;
  scheduledFor: Date | null;
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
    jobRoleId: row.jobRoleId ?? undefined,
    questionSetId: row.questionSetId ?? undefined,
    scheduledDurationMinutes: row.scheduledDurationMinutes,
    startedAt: toIso(row.startedAt),
    scheduledFor: toIso(row.scheduledFor),
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
  jobRoleId?: string;
  /** Set when the role's cached question set already exists — instant-start path. */
  questionSetId?: string;
  /**
   * "in_progress" for an already-cached role (starts right now, startedAt
   * set below); "scheduled" for a freshly-approved one waiting out its
   * 5-minute buffer — see routes/sessions.ts. Defaults to "in_progress" for
   * every caller outside the role-catalog flow (nothing else creates a
   * session any other way).
   */
  status?: Session["status"];
  /** Required (and only meaningful) alongside status: "scheduled". */
  scheduledFor?: Date;
}): Promise<Session> {
  const status = params.status ?? "in_progress";
  const row = await prisma.session.create({
    data: {
      userId: params.userId,
      role: params.role,
      seniority: params.seniority,
      companyContext: params.companyContext,
      stressIntensity: params.stressIntensity,
      status,
      jobRoleId: params.jobRoleId,
      questionSetId: params.questionSetId,
      scheduledDurationMinutes: params.scheduledDurationMinutes,
      startedAt: status === "in_progress" ? new Date() : null,
      scheduledFor: params.scheduledFor,
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
    startedAt: string;
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
      startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
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
      include: { questionSet: { include: { questions: true } }, responses: true, gradingResult: true },
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

  // QuestionSet/Question ARE this user's own private data again (each
  // session gets its own assembled draw — see questionGeneration.ts) and
  // get deleted along with the session. The shared, reusable data lives in
  // BankQuestion instead (owned by JobRole, never touched here — other
  // candidates' sessions may have drawn the same bank questions).
  await prisma.$transaction([
    prisma.response.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.gradingResult.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.question.deleteMany({ where: { questionSetId: { in: questionSetIds } } }),
    prisma.questionSet.deleteMany({ where: { id: { in: questionSetIds } } }),
    prisma.session.deleteMany({ where: { id: { in: sessionIds } } }),
    prisma.subscription.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  return { presentationFrameRefs };
}

// ---- Job role catalog ----

function mapJobRole(row: {
  id: string;
  title: string;
  normalizedKey: string;
  seniority: string;
  status: string;
  saturationScore: number;
  saturationRationale: string;
  createdAt: Date;
  usageCount: number;
  bankSize: number;
}): JobRole {
  return {
    id: row.id,
    title: row.title,
    normalizedKey: row.normalizedKey,
    seniority: row.seniority as JobRole["seniority"],
    status: row.status as JobRole["status"],
    saturationScore: row.saturationScore,
    saturationRationale: row.saturationRationale,
    createdAt: row.createdAt.toISOString(),
    usageCount: row.usageCount,
    bankSize: row.bankSize,
  };
}

export async function getJobRoleByKey(normalizedKey: string, seniority: JobRole["seniority"]): Promise<JobRole | undefined> {
  const row = await prisma.jobRole.findUnique({ where: { normalizedKey_seniority: { normalizedKey, seniority } } });
  return row ? mapJobRole(row) : undefined;
}

export async function getJobRoleById(id: string): Promise<JobRole | undefined> {
  const row = await prisma.jobRole.findUnique({ where: { id } });
  return row ? mapJobRole(row) : undefined;
}

/** Autocomplete search — approved roles only, matched case-insensitively against the title. */
export async function searchApprovedJobRoles(
  query: string,
  seniority: JobRole["seniority"],
  limit = 8,
): Promise<JobRole[]> {
  const rows = await prisma.jobRole.findMany({
    where: {
      status: "approved",
      seniority,
      title: { contains: query, mode: "insensitive" },
    },
    orderBy: [{ usageCount: "desc" }, { title: "asc" }],
    take: limit,
  });
  return rows.map(mapJobRole);
}

export async function createJobRole(params: {
  title: string;
  normalizedKey: string;
  seniority: JobRole["seniority"];
  status: JobRole["status"];
  saturationScore: number;
  saturationRationale: string;
}): Promise<JobRole> {
  const row = await prisma.jobRole.create({ data: params });
  return mapJobRole(row);
}

export async function incrementJobRoleUsage(jobRoleId: string): Promise<void> {
  await prisma.jobRole.update({ where: { id: jobRoleId }, data: { usageCount: { increment: 1 } } });
}

// ---- Question bank ----

function mapBankQuestion(row: {
  id: string;
  jobRoleId: string;
  type: string;
  discipline: string;
  text: string;
  idealAnswerCriteria: string;
  expectedStructure: string | null;
  followUpTriggers: string[];
  ttsAudioBlobRef: string | null;
  createdAt: Date;
  timesUsed: number;
}): BankQuestion {
  return {
    id: row.id,
    jobRoleId: row.jobRoleId,
    type: row.type as BankQuestion["type"],
    discipline: row.discipline,
    text: row.text,
    idealAnswerCriteria: row.idealAnswerCriteria,
    expectedStructure: (row.expectedStructure as BankQuestion["expectedStructure"]) ?? undefined,
    followUpTriggers: row.followUpTriggers.length ? row.followUpTriggers : undefined,
    ttsAudioBlobRef: row.ttsAudioBlobRef ?? undefined,
    createdAt: row.createdAt.toISOString(),
    timesUsed: row.timesUsed,
  };
}

export async function getBankQuestionsForRole(jobRoleId: string): Promise<BankQuestion[]> {
  const rows = await prisma.bankQuestion.findMany({ where: { jobRoleId } });
  return rows.map(mapBankQuestion);
}

/** Bulk-inserts newly generated bank questions and bumps JobRole.bankSize to match, in one transaction. */
export async function createBankQuestions(
  jobRoleId: string,
  questions: Array<{
    type: BankQuestion["type"];
    discipline: string;
    text: string;
    idealAnswerCriteria: string;
    expectedStructure?: BankQuestion["expectedStructure"];
    followUpTriggers?: string[];
    ttsAudioBlobRef?: string;
  }>,
): Promise<void> {
  if (questions.length === 0) return;
  await prisma.$transaction([
    prisma.bankQuestion.createMany({
      data: questions.map((q) => ({
        jobRoleId,
        type: q.type,
        discipline: q.discipline,
        text: q.text,
        idealAnswerCriteria: q.idealAnswerCriteria,
        expectedStructure: q.expectedStructure,
        followUpTriggers: q.followUpTriggers ?? [],
        ttsAudioBlobRef: q.ttsAudioBlobRef,
      })),
    }),
    prisma.jobRole.update({ where: { id: jobRoleId }, data: { bankSize: { increment: questions.length } } }),
  ]);
}

/** Persists a bank question's freshly-synthesized TTS audio ref — mirrors saveQuestion's update-only upsert semantics. */
export async function setBankQuestionAudio(id: string, ttsAudioBlobRef: string): Promise<void> {
  await prisma.bankQuestion.update({ where: { id }, data: { ttsAudioBlobRef } });
}

/** Bumps timesUsed for every bank question a session just drew — informs future sampling toward the least-used rows. */
export async function incrementBankQuestionUsage(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.bankQuestion.updateMany({ where: { id: { in: ids } }, data: { timesUsed: { increment: 1 } } });
}

// ---- A/B testing ----

/** First exposure for a (experiment, subject) wins — a repeat call (e.g. a page revisit) is a no-op, not a second row. */
export async function recordExperimentExposure(params: {
  experimentKey: string;
  variant: string;
  subjectId: string;
}): Promise<void> {
  await prisma.experimentExposure.upsert({
    where: { experimentKey_subjectId: { experimentKey: params.experimentKey, subjectId: params.subjectId } },
    update: {},
    create: params,
  });
}

/** Same one-row-per-subject reasoning as exposure, scoped per goal — a subject converting on the same goal repeatedly still only counts once. */
export async function recordExperimentConversion(params: {
  experimentKey: string;
  variant: string;
  subjectId: string;
  goal: string;
}): Promise<void> {
  await prisma.experimentConversion.upsert({
    where: {
      experimentKey_goal_subjectId: {
        experimentKey: params.experimentKey,
        goal: params.goal,
        subjectId: params.subjectId,
      },
    },
    update: {},
    create: params,
  });
}

/** Unique-subject exposure count per variant — a plain group-by count, since the @@unique constraint already guarantees one row per subject. */
export async function getExperimentExposureCounts(experimentKey: string): Promise<Record<string, number>> {
  const rows = await prisma.experimentExposure.groupBy({
    by: ["variant"],
    where: { experimentKey },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.variant, r._count._all]));
}

export async function getExperimentConversionCounts(
  experimentKey: string,
): Promise<{ variant: string; goal: string; count: number }[]> {
  const rows = await prisma.experimentConversion.groupBy({
    by: ["variant", "goal"],
    where: { experimentKey },
    _count: { _all: true },
  });
  return rows.map((r) => ({ variant: r.variant, goal: r.goal, count: r._count._all }));
}

// ---- End-user communications ----

function mapCommunicationTemplate(row: {
  id: string;
  key: string;
  typeName: string;
  category: string;
  channel: string;
  variant: string;
  subject: string | null;
  body: string;
  variablesUsed: string[];
  createdAt: Date;
  updatedAt: Date;
}): CommunicationTemplate {
  return {
    id: row.id,
    key: row.key,
    typeName: row.typeName,
    category: row.category,
    channel: row.channel as CommunicationTemplate["channel"],
    variant: row.variant,
    subject: row.subject ?? undefined,
    body: row.body,
    variablesUsed: row.variablesUsed,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Upserts by `key` — used both by the one-time CSV seed and by any future admin edit of a template. */
export async function upsertCommunicationTemplate(params: {
  key: string;
  typeName: string;
  category: string;
  channel: CommunicationTemplate["channel"];
  variant: string;
  subject?: string;
  body: string;
  variablesUsed: string[];
}): Promise<CommunicationTemplate> {
  const row = await prisma.communicationTemplate.upsert({
    where: { key: params.key },
    update: {
      typeName: params.typeName,
      category: params.category,
      channel: params.channel,
      variant: params.variant,
      subject: params.subject,
      body: params.body,
      variablesUsed: params.variablesUsed,
    },
    create: params,
  });
  return mapCommunicationTemplate(row);
}

export async function listCommunicationTemplates(): Promise<CommunicationTemplate[]> {
  const rows = await prisma.communicationTemplate.findMany({
    orderBy: [{ category: "asc" }, { typeName: "asc" }, { channel: "asc" }, { variant: "asc" }],
  });
  return rows.map(mapCommunicationTemplate);
}

function mapCommunicationSend(row: {
  id: string;
  templateId: string;
  userId: string;
  channel: string;
  variant: string;
  status: string;
  renderedSubject: string | null;
  renderedBody: string;
  error: string | null;
  sentByUserId: string;
  batchId: string;
  createdAt: Date;
}): CommunicationSend {
  return {
    id: row.id,
    templateId: row.templateId,
    userId: row.userId,
    channel: row.channel as CommunicationSend["channel"],
    variant: row.variant,
    status: row.status as CommunicationSend["status"],
    renderedSubject: row.renderedSubject ?? undefined,
    renderedBody: row.renderedBody,
    error: row.error ?? undefined,
    sentByUserId: row.sentByUserId,
    batchId: row.batchId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createCommunicationSends(
  sends: Array<{
    templateId: string;
    userId: string;
    channel: CommunicationSend["channel"];
    variant: string;
    status: CommunicationSend["status"];
    renderedSubject?: string;
    renderedBody: string;
    error?: string;
    sentByUserId: string;
    batchId: string;
  }>,
): Promise<void> {
  if (sends.length === 0) return;
  await prisma.communicationSend.createMany({ data: sends });
}

/** Most recent sends first — the admin-facing send history/audit log. */
export async function listCommunicationSends(limit = 100): Promise<CommunicationSend[]> {
  const rows = await prisma.communicationSend.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(mapCommunicationSend);
}

// ---- Brand identity admin override ----

/** null means "no override, let the brand-identity experiment decide" — the steady-state row (or no row at all yet). */
export async function getBrandOverride(): Promise<string | null> {
  const row = await prisma.brandOverride.findUnique({ where: { id: "singleton" } });
  return row?.variantKey ?? null;
}

export async function setBrandOverride(variantKey: string | null, updatedByUserId: string): Promise<void> {
  await prisma.brandOverride.upsert({
    where: { id: "singleton" },
    update: { variantKey, updatedByUserId },
    create: { id: "singleton", variantKey, updatedByUserId },
  });
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
  getUserByEmail,
  countUsers,
  upsertSubscriptionByStripeId,
  getActiveSubscriptionForUser,
  listActiveSubscriptions,
  listActiveSubscriberUsers,
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
  getJobRoleByKey,
  getJobRoleById,
  searchApprovedJobRoles,
  createJobRole,
  incrementJobRoleUsage,
  getBankQuestionsForRole,
  createBankQuestions,
  setBankQuestionAudio,
  incrementBankQuestionUsage,
  recordExperimentExposure,
  recordExperimentConversion,
  getExperimentExposureCounts,
  getExperimentConversionCounts,
  upsertCommunicationTemplate,
  listCommunicationTemplates,
  createCommunicationSends,
  listCommunicationSends,
  getBrandOverride,
  setBrandOverride,
};
