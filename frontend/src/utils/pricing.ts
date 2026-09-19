import type { Plan } from "../api/types";

/** Shared by BillingPanel and LandingPage so a price change in Stripe renders identically in both places. */
export function formatPlanPrice(plan: Plan): string {
  if (plan.amountCents === null) return "Contact us";
  const amount = (plan.amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: plan.currency.toUpperCase(),
  });
  return plan.interval ? `${amount}/${plan.interval}` : amount;
}
