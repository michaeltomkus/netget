import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Reads the repo-root brand.config.json at runtime via fs, deliberately
// NOT a compile-time `import ... from "../../../brand.config.json"` —
// tsconfig.json's rootDir is "src", so a static import reaching outside it
// would break `tsc -p tsconfig.json` (every emitted file's path is derived
// from its position under rootDir). fileURLToPath(import.meta.url) keeps
// the relative depth correct in both dev (tsx running src/ directly) and
// prod (compiled dist/ mirrors src/'s structure one-for-one) — same
// pattern as services/media.ts's MEDIA_DIR.
const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAND_CONFIG_PATH = join(__dirname, "..", "..", "..", "brand.config.json");

export interface BrandVariant {
  name: string;
  tagline: string;
  description: string;
  footerTagline: string;
}

interface BrandConfigFile {
  defaultVariant: string;
  variants: Record<string, BrandVariant>;
}

const brandConfigFile: BrandConfigFile = JSON.parse(readFileSync(BRAND_CONFIG_PATH, "utf-8"));

export const BRAND_VARIANT_KEYS = Object.keys(brandConfigFile.variants);
export const DEFAULT_BRAND_VARIANT = brandConfigFile.defaultVariant;

/**
 * Every "InterviewAI"/tagline/description string in this app should read
 * from here rather than being typed inline — that's what makes it possible
 * to A/B test a brand name or key message: add a second entry to
 * brand.config.json's `variants`, register its key alongside "control" in
 * an experiment (see services/experiments.ts), and every call site that
 * reads through getBrandVariant(variant) picks it up automatically.
 * Falls back to the default variant for an unknown/undefined key rather
 * than throwing — a stale variant key from a client shouldn't 500 a page.
 */
export function getBrandVariant(variantKey?: string): BrandVariant {
  const key = variantKey && brandConfigFile.variants[variantKey] ? variantKey : brandConfigFile.defaultVariant;
  return brandConfigFile.variants[key];
}
