import { describe, expect, it } from "vitest";
import { assignVariant } from "./assignVariant";

describe("assignVariant", () => {
  it("is deterministic for the same experiment + subject", () => {
    const a = assignVariant("landing-hero-copy", "subject-1", ["control", "direct"]);
    const b = assignVariant("landing-hero-copy", "subject-1", ["control", "direct"]);
    expect(a).toBe(b);
  });

  it("can differ across subjects", () => {
    const variants = ["control", "direct"] as const;
    const assigned = new Set(
      Array.from({ length: 50 }, (_, i) => assignVariant("landing-hero-copy", `subject-${i}`, variants)),
    );
    // With 50 distinct subjects across 2 variants, both should show up —
    // this would only fail if the hash were badly broken (e.g. constant).
    expect(assigned.size).toBeGreaterThan(1);
  });

  it("only ever returns one of the given variants", () => {
    const variants = ["control", "direct", "third"] as const;
    for (let i = 0; i < 30; i++) {
      const variant = assignVariant("some-experiment", `s${i}`, variants);
      expect(variants).toContain(variant);
    }
  });

  it("distributes roughly evenly across variants over many subjects", () => {
    const variants = ["control", "direct"] as const;
    const counts = { control: 0, direct: 0 };
    const n = 2000;
    for (let i = 0; i < n; i++) {
      counts[assignVariant("landing-hero-copy", `subject-${i}`, variants)] += 1;
    }
    // Not a strict 50/50 — just sanity that neither variant is starved.
    expect(counts.control).toBeGreaterThan(n * 0.35);
    expect(counts.direct).toBeGreaterThan(n * 0.35);
  });

  it("actually uses experimentKey in the hash, not just subjectId", () => {
    const variants = ["control", "direct"] as const;
    // If experimentKey were ignored, every subject would get the identical
    // assignment under both keys, always. Across 50 subjects that would
    // only happen by construction, not by chance — so any disagreement
    // proves the key participates.
    const disagreements = Array.from({ length: 50 }, (_, i) => `subject-${i}`).filter(
      (subject) => assignVariant("experiment-a", subject, variants) !== assignVariant("experiment-b", subject, variants),
    );
    expect(disagreements.length).toBeGreaterThan(0);
  });
});
