import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as store from "../db/store.js";
import {
  getFrontendBaseUrl,
  getPaidPriceId,
  getStripeClient,
  isStripeConfigured,
} from "../services/stripe.js";

export const billingRouter = Router();

billingRouter.use(requireAuth());

// Sessions created since the 1st of the current calendar month, reset each
// month rather than a rolling 30 days — simpler to explain to a candidate
// ("resets on the 1st") than a rolling window.
export const FREE_TIER_SESSIONS_PER_MONTH = 3;

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Used by routes/sessions.ts to gate session creation. Active subscribers are unlimited. */
export async function checkFreeTierLimit(userId: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const activeSub = await store.getActiveSubscriptionForUser(userId);
  if (activeSub) return { allowed: true, used: 0, limit: Infinity };

  const used = await store.countSessionsSince(userId, startOfCurrentMonth());
  return { allowed: used < FREE_TIER_SESSIONS_PER_MONTH, used, limit: FREE_TIER_SESSIONS_PER_MONTH };
}

billingRouter.get("/status", async (req, res) => {
  const userId = req.appUser!.id;
  const subscription = await store.getActiveSubscriptionForUser(userId);
  const used = await store.countSessionsSince(userId, startOfCurrentMonth());

  res.json({
    stripeConfigured: isStripeConfigured(),
    subscription,
    freeTier: { used, limit: FREE_TIER_SESSIONS_PER_MONTH },
  });
});

billingRouter.post("/checkout", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: "Billing is not configured" });
  }
  const user = req.appUser!;
  const stripe = getStripeClient();
  const baseUrl = getFrontendBaseUrl();

  try {
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await store.setUserStripeCustomerId(user.id, customerId);
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getPaidPriceId(), quantity: 1 }],
      success_url: `${baseUrl}/?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancelled`,
      client_reference_id: user.id,
    });

    res.json({ url: checkoutSession.url });
  } catch (err) {
    console.error("Failed to create checkout session:", err);
    res.status(502).json({ error: "Failed to start checkout", detail: String(err) });
  }
});

billingRouter.post("/portal", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: "Billing is not configured" });
  }
  const user = req.appUser!;
  if (!user.stripeCustomerId) {
    return res.status(400).json({ error: "No billing account yet — subscribe first" });
  }
  const stripe = getStripeClient();
  const baseUrl = getFrontendBaseUrl();

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${baseUrl}/`,
    });
    res.json({ url: portalSession.url });
  } catch (err) {
    console.error("Failed to create portal session:", err);
    res.status(502).json({ error: "Failed to open billing portal", detail: String(err) });
  }
});
