import { v4 as uuidv4 } from "uuid";
import { getAnthropicClient, MODELS } from "./anthropicClient.js";
import { attachQuestionAudio } from "./ttsCache.js";
import * as store from "../db/store.js";
import type { BankQuestion, GeneratedQuestionSet, Question, QuestionSet, QuestionType, Seniority } from "../types.js";

// How one session's question set is composed when drawn from a role's bank
// — mirrors the taxonomy this app has always required (at least one
// out-of-the-box question, at least two stress questions, a behavioral/
// technical backbone), just now assembled by sampling instead of generated
// fresh per session. See assembleSessionQuestionSet below.
export const SESSION_COMPOSITION: Record<QuestionType, number> = {
  behavioral: 3,
  technical: 3,
  out_of_box: 1,
  stress: 2,
};
export const SESSION_DRAW_TARGET = Object.values(SESSION_COMPOSITION).reduce((a, b) => a + b, 0); // 9

// Bank sizing — deliberately generous multiples of one session's draw, so a
// role has real rotation from the moment it's schedulable rather than
// technically "grown" but still handing out the same handful of questions.
// A brand-new role seeds a bigger-than-one-session batch up front; an
// established one keeps growing in smaller top-ups (see routes/jobRoles.ts
// maybeGrowBank) until it hits the ceiling below, bounding Claude spend on
// any one role.
export const MIN_BANK_SIZE = SESSION_DRAW_TARGET * 2; // 18 — schedulable, with some rotation immediately
export const INITIAL_SEED_SIZE = 24;
export const TOP_UP_BATCH_SIZE = 12;
export const BANK_CEILING = 150;
// Below this, routes/jobRoles.ts maybeGrowBank tops up on every eligible
// session; above it, only occasionally — see there for the exact pacing.
export const HEALTHY_WATERMARK = MIN_BANK_SIZE * 2; // 36

function buildBankTool(minCount: number, maxCount: number) {
  return {
    name: "emit_question_bank",
    description: "Return new interview questions to add to this role's reusable question bank.",
    input_schema: {
      type: "object" as const,
      properties: {
        questions: {
          type: "array" as const,
          minItems: minCount,
          maxItems: maxCount,
          items: {
            type: "object" as const,
            properties: {
              type: {
                type: "string" as const,
                enum: ["behavioral", "technical", "out_of_box", "stress"],
                description:
                  "behavioral: standard STAR-style experience question. technical: role-specific technical question. out_of_box: deliberately unconventional creative/estimation-style question. stress: a pressure-test question tagged with pushback angles for later live follow-up.",
              },
              discipline: {
                type: "string" as const,
                description:
                  "A short sub-topic tag within the role (e.g. 'system design', 'debugging', 'team conflict', 'estimation', 'API design') — spread questions across a genuine variety of these, don't cluster on one or two.",
              },
              text: { type: "string" as const },
              idealAnswerCriteria: {
                type: "string" as const,
                description:
                  "What a strong answer to this specific question, from a candidate at this seniority for this role, would cover. Used later as the grading rubric — never shown to the candidate before they answer.",
              },
              expectedStructure: {
                type: "string" as const,
                enum: ["STAR", "technical_walkthrough", "open_ended"],
              },
              followUpTriggers: {
                type: "array" as const,
                items: { type: "string" as const },
                description:
                  "Only for type=stress: specific pushback/challenge angles a tough interviewer could raise live against a plausible answer.",
              },
            },
            required: ["type", "discipline", "text", "idealAnswerCriteria"],
          },
        },
      },
      required: ["questions"],
    },
  };
}

function systemPrompt(): string {
  return `You are building a reusable bank of mock job-interview questions for a self-practice tool. The candidate is training against these questions; you are not being asked to impersonate them or answer on their behalf.

This bank is drawn from repeatedly across many different candidates and sessions over time — variety matters more than for a one-off set. Spread questions across a genuine range of disciplines/sub-topics within the role (not just the same two or three angles repeated), covering this required taxonomy overall:
- Standard behavioral questions, calibrated to seniority (e.g. a staff-level candidate gets questions about influence and ambiguity, not entry-level basics).
- Standard technical questions scoped to the role, spanning multiple distinct sub-areas.
- Deliberately unconventional "out of the box" questions (creative thinking, estimation, or a scenario with no single correct approach).
- "Stress" questions: pressure-test questions tagged with specific followUpTriggers describing pushback angles a tough interviewer could raise live against a plausible answer (e.g. "if they credit team consensus, challenge whether that was actually the right call").

For every question, write idealAnswerCriteria: a concise rubric of what a strong answer at this seniority would actually cover. This is graded against later, never shown to the candidate up front.

Calibrate difficulty and expectations to the stated seniority level. Use the emit_question_bank tool to return your result — no other output.`;
}

/**
 * Generates `count` new questions for a role's bank (services/jobRoleClassifier.ts
 * picks the role; this only ever runs after a role is approved). Used both
 * for a brand-new role's initial seed and for later top-ups — pass
 * `avoidTexts` (the bank's existing question texts) on a top-up so Claude
 * doesn't regenerate near-duplicates of what's already there. TTS is
 * synthesized once per question here and cached on the BankQuestion row
 * itself, so every future session that draws it reuses the same audio file
 * rather than re-synthesizing.
 */
export async function growQuestionBank(params: {
  jobRoleId: string;
  role: string;
  seniority: Seniority;
  count: number;
  avoidTexts?: string[];
}): Promise<number> {
  const client = getAnthropicClient();

  const avoidBlock =
    params.avoidTexts && params.avoidTexts.length > 0
      ? `\n\nAlready in the bank — do not repeat these or generate close variants of them:\n${params.avoidTexts.map((t) => `- ${t}`).join("\n")}`
      : "";

  const userPrompt = `Role: ${params.role}\nSeniority: ${params.seniority}\nGenerate ${params.count} new bank questions.${avoidBlock}`;

  // A generous +50% ceiling on maxItems gives Claude room to actually hit
  // the target count even if it drops a couple for taxonomy/quality
  // reasons; minItems keeps a floor so a degenerate response doesn't produce
  // almost nothing.
  const tool = buildBankTool(Math.max(1, Math.floor(params.count * 0.6)), Math.ceil(params.count * 1.5));

  const message = await client.messages.create({
    model: MODELS.bulk,
    max_tokens: 8192,
    system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
    tools: [tool],
    tool_choice: { type: "tool", name: "emit_question_bank" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for emit_question_bank");
  }
  const generated = toolUse.input as GeneratedQuestionSet;

  // Synthesize TTS against lightweight {id, text} stand-ins before the bank
  // rows exist (their real ids are assigned by the DB on insert) — the
  // throwaway id here is only used as the audio filename.
  const withAudio = generated.questions.map((q) => ({ ...q, id: uuidv4(), ttsAudioBlobRef: undefined as string | undefined }));
  await attachQuestionAudio(withAudio);

  await store.createBankQuestions(
    params.jobRoleId,
    withAudio.map((q) => ({
      type: q.type,
      discipline: q.discipline,
      text: q.text,
      idealAnswerCriteria: q.idealAnswerCriteria,
      expectedStructure: q.expectedStructure,
      followUpTriggers: q.followUpTriggers,
      ttsAudioBlobRef: q.ttsAudioBlobRef,
    })),
  );

  return withAudio.length;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Draws SESSION_DRAW_TARGET questions from a role's bank for one session —
 * no Claude call. Picks SESSION_COMPOSITION's target count per type,
 * favoring the least-used rows first (shuffled among ties) so a still-small
 * bank rotates rather than always handing out the same top few, falls back
 * to whatever's available across types if a bucket falls short, then
 * shuffles final presentation order — this is deliberately never a fixed,
 * memorizable, chronological sequence. Copies each drawn BankQuestion's
 * content (including its cached ttsAudioBlobRef — no re-synthesis) into a
 * fresh Question row owned by this session's own new QuestionSet.
 */
export async function assembleSessionQuestionSet(params: {
  sessionId: string;
  jobRoleId: string;
}): Promise<QuestionSet> {
  const bank = await store.getBankQuestionsForRole(params.jobRoleId);

  const byType = new Map<QuestionType, BankQuestion[]>();
  for (const q of bank) {
    const list = byType.get(q.type) ?? [];
    list.push(q);
    byType.set(q.type, list);
  }
  for (const [type, list] of byType) {
    byType.set(
      type,
      shuffle(list).sort((a, b) => a.timesUsed - b.timesUsed),
    );
  }

  const picked: BankQuestion[] = [];
  const pickedIds = new Set<string>();
  for (const [type, target] of Object.entries(SESSION_COMPOSITION) as [QuestionType, number][]) {
    const pool = byType.get(type) ?? [];
    for (const q of pool.slice(0, target)) {
      picked.push(q);
      pickedIds.add(q.id);
    }
  }
  // A bucket came up short (small/uneven bank) — top up from whatever's
  // left, least-used first, regardless of type, rather than under-filling.
  if (picked.length < SESSION_DRAW_TARGET) {
    const leftovers = shuffle(bank.filter((q) => !pickedIds.has(q.id))).sort((a, b) => a.timesUsed - b.timesUsed);
    for (const q of leftovers) {
      if (picked.length >= SESSION_DRAW_TARGET) break;
      picked.push(q);
      pickedIds.add(q.id);
    }
  }

  const drawOrder = shuffle(picked);

  const questionSet = await store.createQuestionSet(params.sessionId);
  const questions: Question[] = drawOrder.map((bq, index) => ({
    id: uuidv4(),
    questionSetId: questionSet.id,
    order: index,
    type: bq.type,
    text: bq.text,
    idealAnswerCriteria: bq.idealAnswerCriteria,
    expectedStructure: bq.expectedStructure,
    followUpTriggers: bq.followUpTriggers,
    ttsAudioBlobRef: bq.ttsAudioBlobRef,
  }));

  for (const question of questions) {
    await store.saveQuestion(question);
  }
  await store.incrementBankQuestionUsage(drawOrder.map((q) => q.id));

  return questionSet;
}
