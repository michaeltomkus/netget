const ANON_ID_KEY = "interviewai:anonId";

/**
 * A stable per-browser identity for bucketing signed-out visitors (e.g. the
 * landing page). Persisted in localStorage so it survives reloads/tabs on
 * the same device — not as strong as a server-set cookie, but needs no new
 * infra. Known, disclosed limitation: this id is distinct from the same
 * person's userId after they sign in, so a signed-out exposure and a later
 * signed-in conversion aren't automatically linked as "the same person" —
 * fine for a landing-page copy test (exposure and conversion both happen
 * signed-out), not for tracking a single visitor across the sign-in
 * boundary.
 */
export function getAnonId(): string {
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    // Storage unavailable (private browsing, blocked site data) — bucketing
    // and logging still work, just not sticky across reloads for this visitor.
    return crypto.randomUUID();
  }
}
