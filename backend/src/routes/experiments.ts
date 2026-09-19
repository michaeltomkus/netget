import { Router } from "express";
import { experimentEventLimiter } from "../middleware/rateLimit.js";
import * as store from "../db/store.js";
import { getExperiment } from "../services/experiments.js";
import { captureException } from "../services/sentry.js";

// Deliberately signed-out-reachable — an experiment on the landing page
// (e.g. "landing-hero-copy") has to be able to log exposure/conversion
// before anyone's identified. Not mounted behind requireAuth() anywhere in
// this file; rate-limited instead (see experimentEventLimiter). Variant
// assignment itself is computed client-side (a pure deterministic hash —
// see frontend/src/experiments/assignVariant.ts); this only ever validates
// and records what the client reports, never decides it.
export const experimentsRouter = Router();

const MAX_SUBJECT_ID_LENGTH = 100;
const MAX_GOAL_LENGTH = 60;

function validateEvent(body: unknown): { experimentKey: string; variant: string; subjectId: string } | { error: string } {
  const { experimentKey, variant, subjectId } = (body ?? {}) as Record<string, unknown>;
  if (typeof experimentKey !== "string" || !experimentKey) return { error: "experimentKey is required" };
  if (typeof subjectId !== "string" || !subjectId || subjectId.length > MAX_SUBJECT_ID_LENGTH) {
    return { error: `subjectId is required and must be ${MAX_SUBJECT_ID_LENGTH} characters or fewer` };
  }
  const def = getExperiment(experimentKey);
  if (!def) return { error: "Unknown experimentKey" };
  if (typeof variant !== "string" || !def.variants.includes(variant)) {
    return { error: `variant must be one of ${def.variants.join(", ")}` };
  }
  return { experimentKey, variant, subjectId };
}

// Both handlers below still 204 even when the store write throws (e.g. a
// DB hiccup) — this is best-effort analytics logging on a route that's
// deliberately reachable pre-auth/pre-identification, so there's nothing
// useful for the caller to retry and no reason a transient DB error here
// should surface as a visible failure to an anonymous visitor, let alone
// (as an unhandled rejection previously did) crash the whole process.

experimentsRouter.post("/exposure", experimentEventLimiter, async (req, res) => {
  const validated = validateEvent(req.body);
  if ("error" in validated) return res.status(400).json({ error: validated.error });

  try {
    await store.recordExperimentExposure(validated);
  } catch (err) {
    console.error("Failed to record experiment exposure:", err);
    captureException(err, { route: "POST /api/experiments/exposure" });
  }
  res.status(204).end();
});

experimentsRouter.post("/conversion", experimentEventLimiter, async (req, res) => {
  const validated = validateEvent(req.body);
  if ("error" in validated) return res.status(400).json({ error: validated.error });

  const { goal } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof goal !== "string" || !goal || goal.length > MAX_GOAL_LENGTH) {
    return res.status(400).json({ error: `goal is required and must be ${MAX_GOAL_LENGTH} characters or fewer` });
  }

  try {
    await store.recordExperimentConversion({ ...validated, goal });
  } catch (err) {
    console.error("Failed to record experiment conversion:", err);
    captureException(err, { route: "POST /api/experiments/conversion" });
  }
  res.status(204).end();
});
