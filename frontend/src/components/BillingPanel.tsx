import { useEffect, useState } from "react";
import { getBillingStatus, openBillingPortal, startCheckout } from "../api/client";
import type { BillingStatus } from "../api/types";

// Shown at the top of the schedule page: current plan, free-tier usage, and
// a way to subscribe or manage billing. Stripe's Checkout and Customer
// Portal are both hosted pages — this only ever requests a redirect URL,
// never touches card data itself.
export default function BillingPanel() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBillingStatus()
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function onSubscribe() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await startCheckout();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function onManageBilling() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await openBillingPortal();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
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

  return (
    <div className="billing-panel">
      {status.subscription ? (
        <>
          <p>
            <strong>Subscribed</strong> — unlimited sessions.
            {status.subscription.cancelAtPeriodEnd &&
              ` Cancels at the end of the current period (${new Date(status.subscription.currentPeriodEnd).toLocaleDateString()}).`}
          </p>
          <button type="button" onClick={onManageBilling} disabled={busy} className="secondary">
            Manage billing
          </button>
        </>
      ) : (
        <>
          <p>
            Free plan: {status.freeTier.used}/{status.freeTier.limit} sessions used this month.
          </p>
          <button type="button" onClick={onSubscribe} disabled={busy} className="secondary">
            Subscribe for unlimited sessions
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
