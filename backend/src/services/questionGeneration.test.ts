import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BankQuestion, QuestionSet } from "../types.js";

const getBankQuestionsForRole = vi.fn<(jobRoleId: string) => Promise<BankQuestion[]>>();
const createQuestionSet = vi.fn<(sessionId: string) => Promise<QuestionSet>>();
const saveQuestion = vi.fn();
const incrementBankQuestionUsage = vi.fn<(ids: string[]) => Promise<void>>();

vi.mock("../db/store.js", () => ({
  getBankQuestionsForRole: (...args: [string]) => getBankQuestionsForRole(...args),
  createQuestionSet: (...args: [string]) => createQuestionSet(...args),
  saveQuestion: (...args: [unknown]) => saveQuestion(...args),
  incrementBankQuestionUsage: (...args: [string[]]) => incrementBankQuestionUsage(...args),
}));

const { assembleSessionQuestionSet, SESSION_COMPOSITION, SESSION_DRAW_TARGET } = await import(
  "./questionGeneration.js"
);

function makeBank(jobRoleId: string): BankQuestion[] {
  const bank: BankQuestion[] = [];
  let n = 0;
  for (const [type, count] of Object.entries(SESSION_COMPOSITION) as [BankQuestion["type"], number][]) {
    // 3x the target per type so there's real rotation to observe.
    for (let i = 0; i < count * 3; i++) {
      n += 1;
      bank.push({
        id: `bq_${n}`,
        jobRoleId,
        type,
        discipline: "general",
        text: `Question ${n}`,
        idealAnswerCriteria: "criteria",
        createdAt: new Date().toISOString(),
        timesUsed: i, // spread usage so "least-used first" is observable
      });
    }
  }
  return bank;
}

beforeEach(() => {
  getBankQuestionsForRole.mockReset();
  createQuestionSet.mockReset();
  saveQuestion.mockReset();
  incrementBankQuestionUsage.mockReset();
  createQuestionSet.mockResolvedValue({ id: "qs_1", sessionId: "session_1" });
});

describe("assembleSessionQuestionSet", () => {
  it("draws exactly SESSION_DRAW_TARGET questions matching the composition from a well-stocked bank", async () => {
    getBankQuestionsForRole.mockResolvedValueOnce(makeBank("role_1"));

    await assembleSessionQuestionSet({ sessionId: "session_1", jobRoleId: "role_1" });

    expect(saveQuestion).toHaveBeenCalledTimes(SESSION_DRAW_TARGET);
    const savedTypes = saveQuestion.mock.calls.map(([q]) => q.type);
    for (const [type, count] of Object.entries(SESSION_COMPOSITION)) {
      expect(savedTypes.filter((t) => t === type)).toHaveLength(count);
    }
  });

  it("favors the least-used bank questions within a type, given distinct usage counts", async () => {
    // Behavioral needs 3 (see SESSION_COMPOSITION) — stock 6 with clearly
    // distinct timesUsed so the 3 least-used are deterministically the
    // correct draw regardless of shuffle tie-breaking.
    const behavioral: BankQuestion[] = Array.from({ length: 6 }, (_, i) => ({
      id: `beh_${i}`,
      jobRoleId: "role_1",
      type: "behavioral",
      discipline: "general",
      text: `Behavioral ${i}`,
      idealAnswerCriteria: "criteria",
      createdAt: new Date().toISOString(),
      timesUsed: i * 10, // 0, 10, 20, 30, 40, 50 — no ties
    }));
    const rest = makeBank("role_1").filter((q) => q.type !== "behavioral");
    getBankQuestionsForRole.mockResolvedValueOnce([...behavioral, ...rest]);

    await assembleSessionQuestionSet({ sessionId: "session_1", jobRoleId: "role_1" });

    const drawnBehavioralIds = saveQuestion.mock.calls.map(([q]) => q).filter((q) => q.type === "behavioral").map((q) => q.text);
    expect(drawnBehavioralIds.sort()).toEqual(["Behavioral 0", "Behavioral 1", "Behavioral 2"]);
  });

  it("never fails, and fills from leftovers, when the bank is smaller than the target composition", async () => {
    const smallBank: BankQuestion[] = [
      {
        id: "bq_1",
        jobRoleId: "role_1",
        type: "behavioral",
        discipline: "general",
        text: "Only question",
        idealAnswerCriteria: "criteria",
        createdAt: new Date().toISOString(),
        timesUsed: 0,
      },
    ];
    getBankQuestionsForRole.mockResolvedValueOnce(smallBank);

    await assembleSessionQuestionSet({ sessionId: "session_1", jobRoleId: "role_1" });

    expect(saveQuestion).toHaveBeenCalledTimes(1);
  });

  it("copies the bank question's cached ttsAudioBlobRef instead of re-synthesizing", async () => {
    const bank = makeBank("role_1");
    bank[0].ttsAudioBlobRef = "/media/questions/cached.mp3";
    getBankQuestionsForRole.mockResolvedValueOnce(bank);

    await assembleSessionQuestionSet({ sessionId: "session_1", jobRoleId: "role_1" });

    const saved = saveQuestion.mock.calls.map(([q]) => q);
    const withCachedAudio = saved.find((q) => q.text === bank[0].text);
    if (withCachedAudio) {
      expect(withCachedAudio.ttsAudioBlobRef).toBe("/media/questions/cached.mp3");
    }
  });
});
