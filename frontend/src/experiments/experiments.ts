// The frontend mirror of backend/src/services/experiments.ts — both need
// to agree on valid experiment keys/variants (the backend validates
// incoming exposure/conversion events against its own copy of this list),
// but only the frontend actually assigns variants (see assignVariant.ts).
//
// To A/B test a whole page: call useExperiment() once near the top of that
// page and branch its return value around whatever differs (copy, layout,
// which component renders). To A/B test one sub-component: call it
// wherever that component is rendered instead — same hook, same pattern,
// just a smaller slice of the tree depends on the result. See
// pages/LandingPage.tsx's "landing-hero-copy" experiment for a worked
// example of the whole-page-section case.
export const EXPERIMENTS = {
  "landing-hero-copy": ["control", "direct"],
  // The product's own name/tagline — see brand.config.json for each
  // variant's copy and hooks/useBrand.ts for how this combines with an
  // admin-set override (which wins over this experiment's per-visitor
  // split when set, without needing to unregister the experiment).
  "brand-identity": ["control", "alt"],
} as const;

export type ExperimentKey = keyof typeof EXPERIMENTS;
export type VariantOf<K extends ExperimentKey> = (typeof EXPERIMENTS)[K][number];
