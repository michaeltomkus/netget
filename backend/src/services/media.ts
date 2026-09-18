import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
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

const FRAMES_ROOT = join(MEDIA_DIR, "..", "frames");

export function savePresentationFrames(sessionId: string, buffers: Buffer[]): string[] {
  const dir = join(FRAMES_ROOT, sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return buffers.map((buffer, i) => {
    const filename = `${i}.jpg`;
    writeFileSync(join(dir, filename), buffer);
    return join(dir, filename);
  });
}

/** Deletes sampled presentation frames from disk — called once grading has
 * consumed them, per docs/ARCHITECTURE.md §7 risk #1's privacy-safer default
 * (derived scores are kept; raw images are not). */
export function deletePresentationFrames(framePaths: string[]): void {
  for (const path of framePaths) {
    try {
      rmSync(path, { force: true });
    } catch {
      // best-effort cleanup; a leftover temp frame is not worth failing grading over
    }
  }
}
