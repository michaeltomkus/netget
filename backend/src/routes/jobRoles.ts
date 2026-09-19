import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { jobRoleRequestLimiter } from "../middleware/rateLimit.js";
import * as store from "../db/store.js";
import { classifyJobRole, normalizeKey, SATURATION_APPROVAL_THRESHOLD } from "../services/jobRoleClassifier.js";
import { generateRoleQuestionSet } from "../services/questionGeneration.js";
import { captureException } from "../services/sentry.js";
import type { Seniority } from "../types.js";

export const jobRolesRouter = Router();

jobRolesRouter.use(requireAuth());

const SENIORITIES: Seniority[] = ["junior", "mid", "senior", "staff", "exec"];
const MAX_TITLE_LENGTH = 100;

// Autocomplete — approved roles only. An empty/short q returns this
// seniority's most-used roles rather than nothing, so the dropdown isn't
// empty the moment the field gains focus.
jobRolesRouter.get("/", async (req, res) => {
  const seniority = req.query.seniority;
  if (typeof seniority !== "string" || !SENIORITIES.includes(seniority as Seniority)) {
    return res.status(400).json({ error: `seniority must be one of ${SENIORITIES.join(", ")}` });
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const roles = await store.searchApprovedJobRoles(q, seniority as Seniority);
  res.json({ roles });
});

// Request a role that doesn't already have a catalog entry for this
// seniority. Normalizes + scores it (services/jobRoleClassifier.ts) and
// either approves (creating the entry, question generation kicked off
// separately once the candidate actually schedules it — see
// routes/sessions.ts) or rejects it outright. Idempotent: the same
// (title, seniority) — or anything Claude normalizes to the same canonical
// title — returns the existing row instead of reclassifying and duplicating.
jobRolesRouter.post("/request", jobRoleRequestLimiter, async (req, res) => {
  const { title, seniority } = req.body ?? {};
  if (typeof title !== "string" || title.trim().length === 0) {
    return res.status(400).json({ error: "title is required" });
  }
  if (title.trim().length > MAX_TITLE_LENGTH) {
    return res.status(400).json({ error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` });
  }
  if (typeof seniority !== "string" || !SENIORITIES.includes(seniority as Seniority)) {
    return res.status(400).json({ error: `seniority must be one of ${SENIORITIES.join(", ")}` });
  }
  const trimmedTitle = title.trim();
  const typedSeniority = seniority as Seniority;

  // Cheap pre-check against the raw typed text — avoids spending a Claude
  // call on an exact repeat of a title someone already requested.
  const rawKey = normalizeKey(trimmedTitle);
  const existingByRawKey = await store.getJobRoleByKey(rawKey, typedSeniority);
  if (existingByRawKey) {
    return res.json({ jobRole: existingByRawKey });
  }

  try {
    const classification = await classifyJobRole(trimmedTitle, typedSeniority);
    const normalizedKey = normalizeKey(classification.normalizedTitle);

    // Claude's normalization can map different raw text onto an existing
    // canonical title (e.g. "Sr Backend Eng" -> "Backend Engineer") — check
    // again under the normalized key before creating a duplicate entry.
    const existingByNormalizedKey = await store.getJobRoleByKey(normalizedKey, typedSeniority);
    if (existingByNormalizedKey) {
      return res.json({ jobRole: existingByNormalizedKey });
    }

    const jobRole = await store.createJobRole({
      title: classification.normalizedTitle,
      normalizedKey,
      seniority: typedSeniority,
      status: classification.saturationScore >= SATURATION_APPROVAL_THRESHOLD ? "approved" : "rejected",
      saturationScore: classification.saturationScore,
      saturationRationale: classification.rationale,
    });

    res.json({ jobRole });
  } catch (err) {
    console.error("Failed to classify job role:", err);
    captureException(err, { route: "POST /api/job-roles/request", title: trimmedTitle, seniority: typedSeniority });
    res.status(502).json({ error: "Failed to evaluate this role — try again", detail: String(err) });
  }
});

// Best-effort, fire-and-forget: kicks off the once-ever generation call for
// a freshly-approved role's cached question set. Not awaited by its caller
// (routes/sessions.ts) — the candidate's 5-minute schedule buffer is what
// actually gives this time to finish, not the HTTP request. In-process only
// (no job queue in this app) — a server restart mid-generation loses the
// attempt; the next person to schedule this same role would then retrigger
// it, since this is only ever called from a path that checks
// jobRole.questionSetId is still unset first.
export async function ensureRoleQuestionSetGenerated(jobRoleId: string, role: string, seniority: Seniority): Promise<void> {
  try {
    const questionSet = await generateRoleQuestionSet({ jobRoleId, role, seniority });
    await store.attachJobRoleQuestionSet(jobRoleId, questionSet.id);
  } catch (err) {
    console.error(`Failed to generate cached question set for job role ${jobRoleId}:`, err);
    captureException(err, { context: "ensureRoleQuestionSetGenerated", jobRoleId });
  }
}
