import brandConfigFile from "../../../brand.config.json";

// Mirrors backend/src/config/brand.ts — see that file's header comment for
// why every "InterviewAI"/tagline/description string reads through here
// instead of being typed inline: it's what makes brand name/key-message
// A/B testing possible without touching every call site. Vite bundles this
// as a static import (no fs access in the browser), so unlike the backend
// loader this is just a plain JSON import; both read the exact same
// repo-root brand.config.json.

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

const config = brandConfigFile as BrandConfigFile;

export const BRAND_VARIANT_KEYS = Object.keys(config.variants);
export const DEFAULT_BRAND_VARIANT = config.defaultVariant;

/** Falls back to the default variant for an unknown/undefined key rather than throwing. */
export function getBrandVariant(variantKey?: string): BrandVariant {
  const key = variantKey && config.variants[variantKey] ? variantKey : config.defaultVariant;
  return config.variants[key];
}
