import { useEffect, useState } from "react";
import { getBillingStatus, getPlans, openBillingPortal, startCheckout } from "../api/client";
import type { BillingInterval, BillingStatus, Plan } from "../api/types";
import { formatPlanPrice, formatPrice } from "../utils/pricing";
import { consumePendingCheckoutPlan } from "../utils/checkoutIntent";

// Shown at the top of the schedule page: current plan, free-tier usage
// (with an escalating nudge as the monthly limit approaches), and a way to
// subscribe or manage billing. Stripe's Checkout and Customer Portal are
// both hosted pages — this only ever requests a redirect URL, never touches
// card data itself.
export default function BillingPanel() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBillingStatus()
      .then((s) => {
        setStatus(s);
        if (s.stripeConfigured && !s.subscription) {
          return getPlans().then(({ plans }) => {
            setPlans(plans);
            // Resumes checkout for whatever plan was clicked on the landing
            // page before sign-in (see utils/checkoutIntent.ts) — only once
            // we know the plan is still real and the candidate isn't
            // already subscribed to something else.
            const pendingPlanId = consumePendingCheckoutPlan();
            if (pendingPlanId && plans.some((p) => p.id === pendingPlanId)) {
              onSubscribe(pendingPlanId);
            }
          });
        }
        // Already subscribed, or billing isn't configured — an intent from
        // before sign-in no longer applies either way.
        consumePendingCheckoutPlan();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function onSubscribe(planId: string) {
    setBusyPlanId(planId);
    setError(null);
    try {
      const { url } = await startCheckout(planId, billingInterval);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusyPlanId(null);
    }
  }

  async function onManageBilling() {
    setPortalBusy(true);
    setError(null);
    try {
      const { url } = await openBillingPortal();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPortalBusy(false);
    }
  }

  if (!status) return null;

  if (!status.stripeConfigured) {
    return (
      <div className="billing-panel muted">
        <p>Billing isn't configured for this deployment — running in unrestricted free mode.</p>
      </div>
    );
  }

  if (status.subscription) {
    return (
      <div className="billing-panel">
        <p>
          <strong>{status.plan?.name ?? "Subscribed"}</strong> — unlimited sessions.
          {status.subscription.cancelAtPeriodEnd &&
            ` Cancels at the end of the current period (${new Date(status.subscription.currentPeriodEnd).toLocaleDateString()}).`}
        </p>
        <button type="button" onClick={onManageBilling} disabled={portalBusy} className="secondary">
          Manage billing
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const remaining = status.freeTier.limit - status.freeTier.used;
  const nudgeClass = remaining <= 0 ? "billing-nudge--urgent" : remaining === 1 ? "billing-nudge--warn" : "";
  const usageText =
    remaining <= 0
      ? `You've used all ${status.freeTier.limit} free sessions this month — subscribe to keep going.`
      : remaining === 1
        ? `Just 1 free session left this month.`
        : `Free plan: ${status.freeTier.used}/${status.freeTier.limit} sessions used this month.`;

  const hasAnnual = plans.some((p) => p.annual);
  const trialDays = plans.find((p) => p.trialPeriodDays)?.trialPeriodDays;

  return (
    <div className="billing-panel billing-panel--plans">
      <p className={nudgeClass || undefined}>{usageText}</p>
      {trialDays && <p className="muted">New subscriptions start with a {trialDays}-day free trial.</p>}
      {hasAnnual && (
        <div className="billing-interval-toggle" role="group" aria-label="Billing interval">
          <button
            type="button"
            className={billingInterval === "monthly" ? "" : "secondary"}
            onClick={() => setBillingInterval("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={billingInterval === "annual" ? "" : "secondary"}
            onClick={() => setBillingInterval("annual")}
          >
            Annual
          </button>
        </div>
      )}
      {plans.length > 0 && (
        <div className="plan-cards">
          {plans.map((plan) => {
            const priceDisplay =
              billingInterval === "annual" && plan.annual ? formatPrice(plan.annual) : formatPlanPrice(plan);
            return (
              <div className="plan-card" key={plan.id}>
                <h4>{plan.name}</h4>
                <p className="plan-price">{priceDisplay}</p>
                <p className="muted plan-tagline">{plan.tagline}</p>
                <button
                  type="button"
                  onClick={() => onSubscribe(plan.id)}
                  disabled={busyPlanId !== null}
                  className="secondary"
                >
                  {busyPlanId === plan.id ? "Redirecting…" : `Subscribe to ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
