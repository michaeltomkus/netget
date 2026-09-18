import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Session,
  QuestionSet,
  Question,
  Response,
  GradingResult,
} from "../types.js";

// Phase 1 storage: a flat JSON file, loaded into memory on boot and rewritten
// on every mutation. This stands in for the IStorage interface described in
// docs/ARCHITECTURE.md §2.4 — swap this module for a real Blob/DB-backed
// implementation later without touching callers, which only ever import the
// exported functions below.

interface Db {
  sessions: Record<string, Session>;
  questionSets: Record<string, QuestionSet>;
  questions: Record<string, Question>;
  responses: Record<string, Response>;
  gradingResults: Record<string, GradingResult>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const DB_PATH = join(DATA_DIR, "db.json");

function emptyDb(): Db {
  return {
    sessions: {},
    questionSets: {},
    questions: {},
    responses: {},
    gradingResults: {},
  };
}

function load(): Db {
  if (!existsSync(DB_PATH)) return emptyDb();
  try {
    const raw = readFileSync(DB_PATH, "utf-8");
    return { ...emptyDb(), ...JSON.parse(raw) };
  } catch {
    return emptyDb();
  }
}

const db: Db = load();

function persist(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

export const store = {
  saveSession(session: Session): void {
    db.sessions[session.id] = session;
    persist();
  },
  getSession(id: string): Session | undefined {
    return db.sessions[id];
  },

  saveQuestionSet(set: QuestionSet): void {
    db.questionSets[set.id] = set;
    persist();
  },
  getQuestionSet(id: string): QuestionSet | undefined {
    return db.questionSets[id];
  },

  saveQuestion(question: Question): void {
    db.questions[question.id] = question;
    persist();
  },
  getQuestion(id: string): Question | undefined {
    return db.questions[id];
  },
  getQuestionsBySet(questionSetId: string): Question[] {
    const set = db.questionSets[questionSetId];
    if (!set) return [];
    return set.questionIds
      .map((id) => db.questions[id])
      .filter((q): q is Question => Boolean(q))
      .sort((a, b) => a.order - b.order);
  },

  saveResponse(response: Response): void {
    db.responses[response.id] = response;
    persist();
  },
  getResponsesBySession(sessionId: string): Response[] {
    return Object.values(db.responses).filter(
      (r) => r.sessionId === sessionId,
    );
  },

  saveGradingResult(result: GradingResult): void {
    db.gradingResults[result.id] = result;
    persist();
  },
  getGradingResultBySession(sessionId: string): GradingResult | undefined {
    return Object.values(db.gradingResults).find(
      (g) => g.sessionId === sessionId,
    );
  },
};
