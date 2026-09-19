import { useEffect, useState } from "react";
import { getBrandOverride } from "../api/client";
import { getBrandVariant, type BrandVariant } from "../config/brand";
import { useExperiment } from "../experiments/useExperiment";

// Shared across every useBrand() call in the app, not per-component — the
// override rarely changes mid-session, so remounting AppShell (route
// changes, etc.) reuses the first fetch instead of re-requesting it. A
// failed fetch clears the cache so the next mount retries rather than
// getting stuck on a rejected promise forever.
let overridePromise: Promise<{ overrideVariant: string | null }> | null = null;

function fetchBrandOverrideOnce(): Promise<{ overrideVariant: string | null }> {
  if (!overridePromise) {
    overridePromise = getBrandOverride().catch((err) => {
      overridePromise = null;
      throw err;
    });
  }
  return overridePromise;
}

/** Test-only: clears the module-level override cache so each test starts fresh. */
export function __resetBrandOverrideCacheForTests(): void {
  overridePromise = null;
}

/**
 * Resolves which brand variant to render right now: an admin-set override
 * if one exists (see /admin's "Brand identity" panel), else the
 * "brand-identity" experiment's per-visitor split (same deterministic hash
 * every other experiment in this app uses). Use this everywhere a
 * component shows the product's own name/tagline/description — never the
 * static `getBrandVariant()` with no argument, which always returns the
 * default variant regardless of the experiment or an override.
 *
 * The override check is a network call (this hook can't know the answer
 * synchronously the way pure hash-based assignment can), so on the very
 * first render — before that fetch resolves — this returns the
 * experiment's natural per-visitor variant. If an override is active, the
 * display then updates once the fetch completes; if not, nothing visibly
 * changes. This also means exposure logging (via useExperiment, below)
 * always reflects a visitor's natural hash bucket, even while an override
 * is forcing everyone to see one variant — that's intentional: it keeps
 * "what would this visitor have seen without the override" data flowing,
 * in case the override is later lifted.
 */
export function useBrand(): BrandVariant {
  const [overrideVariant, setOverrideVariant] = useState<string | null>(null);

  useEffect(() => {
    fetchBrandOverrideOnce()
      .then(({ overrideVariant }) => setOverrideVariant(overrideVariant))
      .catch(() => {
        // Best-effort — if this fails, fall back to the experiment's own
        // variant rather than surfacing an error over a brand-name lookup.
      });
  }, []);

  const { variant: experimentVariant } = useExperiment("brand-identity");

  return getBrandVariant(overrideVariant ?? experimentVariant);
}
