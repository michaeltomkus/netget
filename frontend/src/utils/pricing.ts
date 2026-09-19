import type { Plan } from "../api/types";

interface PriceLike {
  amountCents: number | null;
  currency: string;
  interval?: string;
}

/** Shared by BillingPanel and LandingPage so a price change in Stripe renders identically in both places. */
export function formatPrice(price: PriceLike): string {
  if (price.amountCents === null) return "Contact us";
  const amount = (price.amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: price.currency.toUpperCase(),
  });
  return price.interval ? `${amount}/${price.interval}` : amount;
}

/** The monthly price specifically — most call sites only ever showed this before annual billing existed. */
export function formatPlanPrice(plan: Plan): string {
  return formatPrice(plan);
}
