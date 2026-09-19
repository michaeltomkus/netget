import { getBrandVariant, type BrandVariant } from "../config/brand.js";
import * as store from "../db/store.js";

/**
 * Resolves the brand variant actually in effect for server-side rendering
 * (currently: the app_name merge field in outgoing communications) — an
 * admin-set override if one is set, else the config's default variant.
 * Client-visitor-facing brand selection (the "brand-identity" experiment's
 * per-visitor hash split) lives on the frontend instead — see
 * frontend/src/hooks/useBrand.ts, which layers the same override on top of
 * that hash.
 *
 * Never throws: a DB error reading the override (e.g. Postgres briefly
 * unreachable) falls back to the default variant rather than propagating —
 * same reasoning as the experiments.ts exposure/conversion routes' fix,
 * just applied proactively here instead of after an outage.
 */
export async function getEffectiveBrandVariant(): Promise<BrandVariant> {
  let override: string | null = null;
  try {
    override = await store.getBrandOverride();
  } catch (err) {
    console.warn("Failed to read brand override, using the default variant:", err);
  }
  return getBrandVariant(override ?? undefined);
}
