import { useEffect, useState } from "react";
import { getBillingStatus, getPlans, openBillingPortal, startCheckout } from "../api/client";
import type { BillingStatus, Plan } from "../api/types";

function formatPrice(plan: Plan): string {
  if (plan.amountCents === null) return "Contact us";
  const amount = (plan.amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: plan.currency.toUpperCase(),
  });
  return plan.interval ? `${amount}/${plan.interval}` : amount;
}

// Shown at the top of the schedule page: current plan, free-tier usage
// (with an escalating nudge as the monthly limit approaches), and a way to
// subscribe or manage billing. Stripe's Checkout and Customer Portal are
// both hosted pages — this only ever requests a redirect URL, never touches
// card data itself.
export default function BillingPanel() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBillingStatus()
      .then((s) => {
        setStatus(s);
        if (s.stripeConfigured && !s.subscription) {
          return getPlans().then(({ plans }) => setPlans(plans));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function onSubscribe(planId: string) {
    setBusyPlanId(planId);
    setError(null);
    try {
      const { url } = await startCheckout(planId);
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

  return (
    <div className="billing-panel billing-panel--plans">
      <p className={nudgeClass || undefined}>{usageText}</p>
      {plans.length > 0 && (
        <div className="plan-cards">
          {plans.map((plan) => (
            <div className="plan-card" key={plan.id}>
              <h4>{plan.name}</h4>
              <p className="plan-price">{formatPrice(plan)}</p>
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
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
