import { Router } from "express";
import type Stripe from "stripe";
import * as store from "../db/store.js";
import { getStripeClient, isStripeConfigured } from "../services/stripe.js";
import { captureException } from "../services/sentry.js";
import type { SubscriptionStatus } from "../types.js";

export const stripeWebhookRouter = Router();

// Mounted in index.ts with express.raw() (NOT express.json()) — Stripe's
// signature verification needs the exact raw request bytes, which JSON
// parsing would already have consumed/reserialized and broken.
stripeWebhookRouter.post("/", async (req, res) => {
  if (!isStripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: "Billing is not configured" });
  }
  const stripe = getStripeClient();
  const signature = req.headers["stripe-signature"];

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      signature as string,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.warn("Stripe webhook signature verification failed:", err instanceof Error ? err.message : err);
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        // Every other event type is a no-op here — Stripe is the source of
        // truth for billing itself, this handler only mirrors subscription
        // status locally for gating/admin-metrics purposes.
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error(`Failed to process Stripe webhook ${event.type}:`, err);
    // A silently-failing webhook is exactly the kind of thing that would
    // otherwise go unnoticed until a subscriber complains — worth alerting
    // on even though it's already handled locally.
    captureException(err, { stripeEventType: event.type, stripeEventId: event.id });
    // 500 so Stripe retries — losing a subscription status update silently
    // would let a cancelled subscriber keep free-tier-bypassing access.
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const user = await store.getUserByStripeCustomerId(customerId);
  if (!user) {
    console.warn(`Stripe webhook: no local user for customer ${customerId}`);
    return;
  }

  const item = subscription.items.data[0];
  await store.upsertSubscriptionByStripeId({
    userId: user.id,
    stripeSubscriptionId: subscription.id,
    stripePriceId: item?.price.id ?? "",
    status: subscription.status as SubscriptionStatus,
    currentPeriodEnd: new Date(item?.current_period_end ? item.current_period_end * 1000 : Date.now()).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
}
