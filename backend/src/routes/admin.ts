import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as store from "../db/store.js";
import { getStripeClient, isStripeConfigured } from "../services/stripe.js";

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

// Revenue/usage metrics only — no user-management write actions (manual
// comp/grant, cancel/refund) are exposed here, by explicit scope decision.
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

  res.json({
    totalUsers,
    activeSubscriberCount: activeSubscriptions.length,
    freeUserCount: totalUsers - activeSubscriptions.length,
    sessionsThisMonth,
    sessionsAllTime,
    mrrCents,
  });
});
