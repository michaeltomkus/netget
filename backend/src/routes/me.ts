import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { requireAuth } from "../middleware/auth.js";
import * as store from "../db/store.js";
import { deletePresentationFrames } from "../services/media.js";
import { getStripeClient, isStripeConfigured } from "../services/stripe.js";
import { captureException } from "../services/sentry.js";

export const meRouter = Router();

meRouter.use(requireAuth());

meRouter.get("/", (req, res) => {
  res.json({ user: req.appUser });
});

// GDPR-style "download my data" — everything this app has stored about the
// caller: profile, every session (questions/responses/grading), and
// subscription history. Doesn't include Clerk's own identity fields (name/
// email already come from Clerk) or Stripe's billing records — those live
// in, and are each separately exportable from, their own systems.
meRouter.get("/export", async (req, res) => {
  const data = await store.getFullUserExport(req.appUser!.id);
  res.json(data);
});

// Permanently deletes the caller's account: cancels any active Stripe
// subscription first (so they're not left being billed for an account that
// no longer exists — if this fails, abort rather than delete an account
// still attached to a live subscription with no portal left to manage it
// from), then deletes every local row this app stores about them, and only
// once that's confirmed does it delete the Clerk identity itself — the
// least reversible step, done last so a failure anywhere earlier leaves
// the account intact and safely retryable rather than half-deleted.
meRouter.delete("/", async (req, res) => {
  const user = req.appUser!;
  try {
    if (isStripeConfigured() && user.stripeCustomerId) {
      const subscription = await store.getActiveSubscriptionForUser(user.id);
      if (subscription) {
        await getStripeClient().subscriptions.cancel(subscription.stripeSubscriptionId);
      }
    }
  } catch (err) {
    console.error("Failed to cancel subscription during account deletion:", err);
    captureException(err, { route: "DELETE /api/me", step: "cancel_subscription", userId: user.id });
    return res.status(502).json({ error: "Failed to cancel your subscription — account was not deleted, try again" });
  }

  try {
    const { presentationFrameRefs } = await store.deleteUserAndAllData(user.id);
    deletePresentationFrames(presentationFrameRefs);
  } catch (err) {
    console.error("Failed to delete account data:", err);
    captureException(err, { route: "DELETE /api/me", step: "delete_data", userId: user.id });
    return res.status(502).json({ error: "Failed to delete your account data — try again" });
  }

  if (process.env.CLERK_SECRET_KEY) {
    try {
      await clerkClient.users.deleteUser(user.clerkUserId);
    } catch (err) {
      // Local data is already gone at this point — surface the failure but
      // don't tell the caller deletion failed; it substantively succeeded.
      console.error("Failed to delete Clerk identity after local deletion succeeded:", err);
      captureException(err, { route: "DELETE /api/me", step: "delete_clerk_user", userId: user.id });
    }
  }

  res.json({ ok: true });
});
