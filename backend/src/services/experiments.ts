// The A/B experiment registry — the source of truth for which experiments
// exist and what variants each one has. Adding a new experiment is a code
// change here (plus its frontend mirror at
// frontend/src/experiments/experiments.ts), never a migration: the DB only
// ever logs raw (experimentKey, variant, subjectId) events against
// whatever this list currently says is valid — see routes/experiments.ts.
//
// Variant assignment itself happens client-side (a pure deterministic hash
// of experimentKey+subjectId, equal-weighted across variants — see
// frontend/src/experiments/assignVariant.ts); this registry's job on the
// backend is purely to validate incoming exposure/conversion events aren't
// garbage before they're stored.
export interface ExperimentDefinition {
  key: string;
  description: string;
  /** First entry is the control by convention — not enforced, just a naming convention for readability. */
  variants: string[];
}

export const EXPERIMENTS: ExperimentDefinition[] = [
  {
    key: "landing-hero-copy",
    description: "Landing page hero headline + primary CTA copy — signed-out visitors.",
    variants: ["control", "direct"],
  },
];

export function getExperiment(key: string): ExperimentDefinition | undefined {
  return EXPERIMENTS.find((e) => e.key === key);
}
