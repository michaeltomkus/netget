import { v4 as uuidv4 } from "uuid";
import { getAnthropicClient, MODELS } from "./anthropicClient.js";
import { attachQuestionAudio } from "./ttsCache.js";
import * as store from "../db/store.js";
import type {
  GeneratedQuestionSet,
  Question,
  QuestionSet,
  Seniority,
  StressIntensity,
} from "../types.js";

const QUESTION_SET_TOOL = {
  name: "emit_question_set",
  description:
    "Return the generated interview question set for this mock-interview session.",
  input_schema: {
    type: "object" as const,
    properties: {
      questions: {
        type: "array" as const,
        minItems: 8,
        maxItems: 10,
        items: {
          type: "object" as const,
          properties: {
            type: {
              type: "string" as const,
              enum: ["behavioral", "technical", "out_of_box", "stress"],
              description:
                "behavioral: standard STAR-style experience question. technical: role-specific technical question. out_of_box: deliberately unconventional creative/estimation-style question. stress: a pressure-test question tagged with pushback angles for later live follow-up.",
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
          required: ["type", "text", "idealAnswerCriteria"],
        },
      },
    },
    required: ["questions"],
  },
};

function systemPrompt(): string {
  return `You are designing a mock job-interview question set for a self-practice tool. The candidate is training against these questions; you are not being asked to impersonate them or answer on their behalf.

Generate 8-10 questions for the given role and seniority, covering this required taxonomy:
- Standard behavioral questions, calibrated to seniority (e.g. a staff-level candidate gets questions about influence and ambiguity, not entry-level basics).
- Standard technical questions scoped to the role.
- At least one deliberately unconventional "out of the box" question (creative thinking, estimation, or a scenario with no single correct approach).
- At least two "stress" questions: pressure-test questions tagged with specific followUpTriggers describing pushback angles a tough interviewer could raise live against a plausible answer (e.g. "if they credit team consensus, challenge whether that was actually the right call").

For every question, write idealAnswerCriteria: a concise rubric of what a strong answer at this seniority would actually cover. This is graded against later, never shown to the candidate up front.

Calibrate difficulty and expectations to the stated seniority level. Use the emit_question_set tool to return your result — no other output.`;
}

// A fixed baseline used only for generating the base question set below —
// not the same thing as a candidate's own stressIntensity choice at
// schedule time, which still separately controls how aggressively the live
// Interview Conductor pushes back during a session (see gateway/sttGateway.ts).
// Since one role's question set is now generated once and reused by every
// candidate who schedules that role (see JobRole.questionSetId), it can no
// longer be tailored to any one session's stressIntensity or companyContext
// — this generates a generic, moderately-pressured set that works as a
// reasonable baseline for anyone practicing that role.
const CACHED_SET_STRESS_BASELINE: StressIntensity = "medium";

export async function generateRoleQuestionSet(params: {
  jobRoleId: string;
  role: string;
  seniority: Seniority;
}): Promise<QuestionSet> {
  const client = getAnthropicClient();

  const userPrompt = `Role: ${params.role}
Seniority: ${params.seniority}
Stress intensity for this question set: ${CACHED_SET_STRESS_BASELINE} (this set will be reused across many candidates, so keep it a generic, broadly-applicable baseline rather than tailored to one session)`;

  const message = await client.messages.create({
    model: MODELS.bulk,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: systemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [QUESTION_SET_TOOL],
    tool_choice: { type: "tool", name: "emit_question_set" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for emit_question_set");
  }
  const generated = toolUse.input as GeneratedQuestionSet;

  // QuestionSet row must exist before Questions, which carry a FK to it.
  const questionSet = await store.createQuestionSet(params.jobRoleId);

  const questions: Question[] = generated.questions.map((q, index) => ({
    id: uuidv4(),
    questionSetId: questionSet.id,
    order: index,
    type: q.type,
    text: q.text,
    idealAnswerCriteria: q.idealAnswerCriteria,
    expectedStructure: q.expectedStructure,
    followUpTriggers: q.followUpTriggers,
  }));

  // Pre-synthesize TTS audio for every question now, at schedule time, so
  // there's zero TTS latency for the scripted portion of the interview
  // (docs/ARCHITECTURE.md §1.2 step 1). Non-fatal per question: if TTS isn't
  // configured (or a single call fails), ttsAudioBlobRef stays unset and
  // that question hard-blocks in the UI — see attachQuestionAudio in
  // ttsCache.ts and SessionPage's "Question audio unavailable" state.
  await attachQuestionAudio(questions);

  for (const question of questions) {
    await store.saveQuestion(question);
  }

  return questionSet;
}
