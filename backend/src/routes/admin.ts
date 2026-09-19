import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { communicationSendLimiter } from "../middleware/rateLimit.js";
import * as store from "../db/store.js";
import { getPlanByPriceId, getStripeClient, isStripeConfigured } from "../services/stripe.js";
import { EXPERIMENTS, getExperiment } from "../services/experiments.js";
import { seedCommunicationTemplates } from "../services/communications/seedTemplates.js";
import { sendCommunication, type AudienceSelector } from "../services/communications/send.js";
import { isChannelConfigured } from "../services/communications/providers.js";
import { BRAND_VARIANT_KEYS, getBrandVariant } from "../config/brand.js";
import { getBrandOverrideSafe } from "../services/brand.js";
import type { CommunicationChannel, ExperimentResults } from "../types.js";

export const adminRouter = Router();

adminRouter.use(requireAuth());
adminRouter.use((req, res, next) => {
  if (req.appUser!.role !== "admin") {
    // 404 rather than 403 — same "don't confirm the route exists to a
    // non-admin" posture as loadOwnedSession in routes/sessions.ts.
    return res.status(404).json({ error: "Not found" });
  }
  next();
});

// Revenue/usage metrics only — no *account* write actions (manual
// comp/grant, cancel/refund on an individual user) are exposed here, by
// explicit scope decision; use the Stripe dashboard directly for that. The
// end-user communications endpoints below are a distinct, separately
// requested capability — composing/sending templated messages to users,
// not editing their accounts — so they don't reverse that decision.
adminRouter.get("/metrics", async (_req, res) => {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [totalUsers, activeSubscriptions, sessionsThisMonth, sessionsAllTime] = await Promise.all([
    store.countUsers(),
    store.listActiveSubscriptions(),
    store.countSessionsSinceAllUsers(startOfMonth),
    store.countAllSessions(),
  ]);

  let mrrCents: number | undefined;
  if (isStripeConfigured() && activeSubscriptions.length > 0) {
    try {
      const stripe = getStripeClient();
      const uniquePriceIds = [...new Set(activeSubscriptions.map((s) => s.stripePriceId))];
      const prices = await Promise.all(uniquePriceIds.map((id) => stripe.prices.retrieve(id)));
      const amountByPriceId = new Map(prices.map((p) => [p.id, p.unit_amount ?? 0]));
      mrrCents = activeSubscriptions.reduce(
        (sum, sub) => sum + (amountByPriceId.get(sub.stripePriceId) ?? 0),
        0,
      );
    } catch (err) {
      console.warn("Failed to compute MRR from Stripe prices:", err instanceof Error ? err.message : err);
    }
  }

  // Per-plan breakdown — "unknown" catches subscriptions whose stripePriceId
  // no longer matches a configured plan (e.g. a price env var was rotated
  // out from under an existing subscriber), so the counts always sum to
  // activeSubscriberCount even as plans change.
  const subscribersByPlan: Record<string, number> = {};
  for (const sub of activeSubscriptions) {
    const planId = getPlanByPriceId(sub.stripePriceId)?.id ?? "unknown";
    subscribersByPlan[planId] = (subscribersByPlan[planId] ?? 0) + 1;
  }

  res.json({
    totalUsers,
    activeSubscriberCount: activeSubscriptions.length,
    freeUserCount: totalUsers - activeSubscriptions.length,
    subscribersByPlan,
    sessionsThisMonth,
    sessionsAllTime,
    mrrCents,
  });
});

// A/B experiment results — read-only, same "metrics only" posture as
// /metrics above: this lists what's defined and what happened, nothing
// here can create, edit, or stop an experiment (that's a code change to
// services/experiments.ts).
adminRouter.get("/experiments", (_req, res) => {
  res.json({ experiments: EXPERIMENTS });
});

adminRouter.get("/experiments/:key/results", async (req, res) => {
  const experiment = getExperiment(req.params.key);
  if (!experiment) return res.status(404).json({ error: "Unknown experiment" });

  const [exposures, conversions] = await Promise.all([
    store.getExperimentExposureCounts(experiment.key),
    store.getExperimentConversionCounts(experiment.key),
  ]);

  const results: ExperimentResults = {
    experimentKey: experiment.key,
    description: experiment.description,
    variants: experiment.variants,
    exposures,
    conversions,
  };
  res.json(results);
});

// --- Brand identity control -------------------------------------------
//
// Distinct from /metrics' read-only posture, same as the end-user
// communications endpoints below: this is a genuine write action (forcing
// which brand.config.json variant every visitor sees), explicitly
// requested. It sits alongside, not instead of, the "brand-identity"
// experiment registered in services/experiments.ts — forcing a variant
// here overrides that experiment's per-visitor split without unregistering
// it, so /admin/experiments/brand-identity/results keeps showing
// historical data throughout.

adminRouter.get("/brand", async (_req, res) => {
  const variants = BRAND_VARIANT_KEYS.map((key) => ({ key, ...getBrandVariant(key) }));
  const overrideVariant = await getBrandOverrideSafe();
  res.json({ variants, overrideVariant });
});

adminRouter.post("/brand/override", async (req, res) => {
  const { variantKey } = req.body ?? {};
  if (variantKey !== null && !BRAND_VARIANT_KEYS.includes(variantKey)) {
    return res.status(400).json({
      error: `variantKey must be null (let the experiment decide) or one of: ${BRAND_VARIANT_KEYS.join(", ")}`,
    });
  }
  try {
    await store.setBrandOverride(variantKey, req.appUser!.id);
  } catch (err) {
    console.error("Failed to save brand override:", err);
    return res.status(502).json({ error: "Failed to save — try again" });
  }
  res.json({ overrideVariant: variantKey });
});

// --- End-user communications ---------------------------------------
//
// Compose/send templated, multi-channel (email/sms/push), A/B-variant
// messages to end users. The template library is seeded from a reference
// set of lifecycle communications (see services/communications/seedTemplates.ts)
// grouped by `typeName` (the lifecycle event, e.g. "Welcome / Onboarding")
// x `channel` x `variant` — the composer picks a (typeName, channel) pair
// and an audience, and sends split across whichever variants exist for it.

const CHANNELS: CommunicationChannel[] = ["email", "sms", "push"];

adminRouter.get("/communications/templates", async (_req, res) => {
  try {
    const templates = await store.listCommunicationTemplates();
    res.json({
      templates,
      channelStatus: Object.fromEntries(CHANNELS.map((c) => [c, isChannelConfigured(c)])),
    });
  } catch (err) {
    console.error("Failed to list communication templates:", err);
    res.status(502).json({ error: "Failed to load templates — try again" });
  }
});

// Idempotent — upserts by each template's stable key, so this is safe to
// call again after the reference set changes, and safe for an admin to
// click more than once by accident.
adminRouter.post("/communications/templates/seed", async (_req, res) => {
  try {
    const count = await seedCommunicationTemplates();
    res.json({ seeded: count });
  } catch (err) {
    console.error("Failed to seed communication templates:", err);
    res.status(502).json({ error: "Failed to seed templates — try again" });
  }
});

adminRouter.get("/communications/history", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  try {
    const sends = await store.listCommunicationSends(limit);
    res.json({ sends });
  } catch (err) {
    console.error("Failed to load communication history:", err);
    res.status(502).json({ error: "Failed to load history — try again" });
  }
});

adminRouter.post("/communications/send", communicationSendLimiter, async (req, res) => {
  const { typeName, channel, audience, extraVars } = req.body ?? {};

  if (typeof typeName !== "string" || !typeName.trim()) {
    return res.status(400).json({ error: "typeName is required" });
  }
  if (!CHANNELS.includes(channel)) {
    return res.status(400).json({ error: "channel must be one of email, sms, push" });
  }
  const resolvedAudience = parseAudience(audience);
  if (!resolvedAudience) {
    return res.status(400).json({
      error: 'audience must be { kind: "all" }, { kind: "active_subscribers" }, or { kind: "single", email }',
    });
  }
  if (extraVars !== undefined && (typeof extraVars !== "object" || extraVars === null || Array.isArray(extraVars))) {
    return res.status(400).json({ error: "extraVars must be an object of string values" });
  }

  try {
    const summary = await sendCommunication({
      typeName,
      channel,
      audience: resolvedAudience,
      extraVars,
      sentByUserId: req.appUser!.id,
    });
    res.json(summary);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to send communication" });
  }
});

function parseAudience(input: unknown): AudienceSelector | undefined {
  if (!input || typeof input !== "object") return undefined;
  const kind = (input as { kind?: unknown }).kind;
  if (kind === "all" || kind === "active_subscribers") return { kind };
  if (kind === "single") {
    const email = (input as { email?: unknown }).email;
    if (typeof email === "string" && email.trim()) return { kind: "single", email };
  }
  return undefined;
}
