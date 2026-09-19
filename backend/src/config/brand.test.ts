import { describe, expect, it } from "vitest";
import { BRAND_VARIANT_KEYS, DEFAULT_BRAND_VARIANT, getBrandVariant } from "./brand.js";

// Exercises the real repo-root brand.config.json rather than a mock — the
// whole point of this loader is reading that one shared file correctly
// (see the file's own header comment on why it's an fs read, not a
// compile-time import), so a fixture would test something else entirely.
describe("getBrandVariant", () => {
  it("returns the default variant when called with no key", () => {
    const brand = getBrandVariant();
    expect(brand.name).toBeTruthy();
    expect(brand.tagline).toBeTruthy();
    expect(brand.description).toBeTruthy();
    expect(brand.footerTagline).toBeTruthy();
  });

  it("returns the same data when explicitly passed the default variant's key", () => {
    expect(getBrandVariant(DEFAULT_BRAND_VARIANT)).toEqual(getBrandVariant());
  });

  it("falls back to the default variant for an unknown key rather than throwing", () => {
    expect(getBrandVariant("not-a-real-variant")).toEqual(getBrandVariant());
  });

  it("falls back to the default variant for an empty-string key", () => {
    expect(getBrandVariant("")).toEqual(getBrandVariant());
  });
});

describe("BRAND_VARIANT_KEYS / DEFAULT_BRAND_VARIANT", () => {
  it("lists at least the default variant", () => {
    expect(BRAND_VARIANT_KEYS).toContain(DEFAULT_BRAND_VARIANT);
  });
});
