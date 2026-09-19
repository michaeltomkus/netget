import { Router } from "express";
import { experimentEventLimiter } from "../middleware/rateLimit.js";
import * as store from "../db/store.js";
import { getExperiment } from "../services/experiments.js";

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

experimentsRouter.post("/exposure", experimentEventLimiter, async (req, res) => {
  const validated = validateEvent(req.body);
  if ("error" in validated) return res.status(400).json({ error: validated.error });

  await store.recordExperimentExposure(validated);
  res.status(204).end();
});

experimentsRouter.post("/conversion", experimentEventLimiter, async (req, res) => {
  const validated = validateEvent(req.body);
  if ("error" in validated) return res.status(400).json({ error: validated.error });

  const { goal } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof goal !== "string" || !goal || goal.length > MAX_GOAL_LENGTH) {
    return res.status(400).json({ error: `goal is required and must be ${MAX_GOAL_LENGTH} characters or fewer` });
  }

  await store.recordExperimentConversion({ ...validated, goal });
  res.status(204).end();
});
