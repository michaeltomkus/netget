import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Stands in for Blob Storage (docs/ARCHITECTURE.md §2.4) during local dev —
// swap for a real object-store client later without touching callers.
export const MEDIA_DIR = join(__dirname, "..", "..", "data", "audio");

export function saveQuestionAudio(questionId: string, buffer: Buffer, ext: string): string {
  const dir = join(MEDIA_DIR, "questions");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = `${questionId}.${ext}`;
  writeFileSync(join(dir, filename), buffer);
  return `/media/questions/${filename}`;
}
