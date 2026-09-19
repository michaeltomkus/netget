import { describe, expect, it } from "vitest";
import seedData from "./seedTemplates.data.json" with { type: "json" };

// A lightweight sanity check on the static reference data itself (150 hand
// -derived rows: 25 lifecycle events x 3 channels x 2 A/B variants) —
// catches a malformed row without needing a live DB.
describe("seedTemplates.data.json", () => {
  it("has 150 rows, each with a unique key", () => {
    expect(seedData).toHaveLength(150);
    const keys = new Set(seedData.map((r: { key: string }) => r.key));
    expect(keys.size).toBe(150);
  });

  it("covers exactly the 3 supported channels and both A/B variants for every row", () => {
    const channels = new Set(seedData.map((r: { channel: string }) => r.channel));
    expect(channels).toEqual(new Set(["email", "sms", "push"]));
    const variants = new Set(seedData.map((r: { variant: string }) => r.variant));
    expect(variants).toEqual(new Set(["A", "B"]));
  });

  it("every row has a non-empty body and typeName/category", () => {
    for (const row of seedData as { body: string; typeName: string; category: string }[]) {
      expect(row.body.length).toBeGreaterThan(0);
      expect(row.typeName.length).toBeGreaterThan(0);
      expect(row.category.length).toBeGreaterThan(0);
    }
  });

  it("has exactly 6 rows (2 variants x 3 channels) per typeName", () => {
    const counts = new Map<string, number>();
    for (const row of seedData as { typeName: string }[]) {
      counts.set(row.typeName, (counts.get(row.typeName) ?? 0) + 1);
    }
    for (const count of counts.values()) {
      expect(count).toBe(6);
    }
  });
});
