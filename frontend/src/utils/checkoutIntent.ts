// Carries "which plan did they click" across the sign-in redirect. The
// landing page's pricing CTAs only open Clerk's sign-in modal (see
// LandingPage.tsx) — this is what lets BillingPanel, once the candidate
// lands on the real Schedule page signed in, resume checkout for that plan
// automatically instead of making them find and click Subscribe again.
const KEY = "interviewai:pendingCheckoutPlan";

export function setPendingCheckoutPlan(planId: string): void {
  try {
    sessionStorage.setItem(KEY, planId);
  } catch {
    // Storage can throw (private browsing, blocked site data) — losing the
    // intent just means no auto-resume, not a broken checkout.
  }
}

/** Reads and clears the pending plan in one call — it's only ever meant to fire once. */
export function consumePendingCheckoutPlan(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
