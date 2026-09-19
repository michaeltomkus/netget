import { useCallback, useEffect, useMemo } from "react";
import { logExperimentConversion, logExperimentExposure } from "../api/client";
import { useAppUser } from "../hooks/useAppUser";
import { assignVariant } from "./assignVariant";
import { EXPERIMENTS, type ExperimentKey, type VariantOf } from "./experiments";
import { getAnonId } from "./subjectId";

// De-dupes exposure logging within one page session on top of the
// server's own @@unique-constraint dedup (see backend
// routes/experiments.ts) — avoids firing the network call again on every
// re-render, not a correctness requirement.
const loggedExposures = new Set<string>();

/**
 * Buckets the caller into a variant for `experimentKey` and logs exposure
 * once. Subject identity is the signed-in user's id once known, or a
 * stable per-browser anonymous id before that (see subjectId.ts). Returns
 * both the assigned variant (branch whatever renders differently on it —
 * copy, layout, which component) and a bound `logConversion(goal)` that
 * already knows this subject/variant, for whenever the experiment's goal
 * action happens (a click, a completed signup, ...). Works identically for
 * a whole page (call once near the top) or one sub-component (call wherever
 * that component lives) — see pages/LandingPage.tsx for a worked example.
 */
export function useExperiment<K extends ExperimentKey>(
  experimentKey: K,
): { variant: VariantOf<K>; logConversion: (goal: string) => void } {
  const { user } = useAppUser();
  const subjectId = user?.id ?? getAnonId();
  const variants = EXPERIMENTS[experimentKey];
  const variantsKey = variants.join(",");
  const variant = useMemo(
    () => assignVariant(experimentKey, subjectId, variants),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [experimentKey, subjectId, variantsKey],
  ) as VariantOf<K>;

  useEffect(() => {
    const dedupeKey = `${experimentKey}:${subjectId}`;
    if (loggedExposures.has(dedupeKey)) return;
    loggedExposures.add(dedupeKey);
    logExperimentExposure(experimentKey, variant, subjectId).catch(() => {
      // Best-effort analytics — losing one exposure log is never worth
      // surfacing an error to the candidate over.
    });
  }, [experimentKey, subjectId, variant]);

  const logConversion = useCallback(
    (goal: string) => {
      logExperimentConversion(experimentKey, variant, subjectId, goal).catch(() => {});
    },
    [experimentKey, variant, subjectId],
  );

  return { variant, logConversion };
}
