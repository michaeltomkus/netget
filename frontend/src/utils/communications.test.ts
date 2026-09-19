import { describe, expect, it } from "vitest";
import type { CommunicationTemplate } from "../api/types";
import { channelsForEvent, groupTemplatesByCategory } from "./communications";

function makeTemplate(overrides: Partial<CommunicationTemplate>): CommunicationTemplate {
  return {
    id: "id",
    key: "key",
    typeName: "Welcome / Onboarding",
    category: "Onboarding",
    channel: "email",
    variant: "A",
    body: "Hi",
    variablesUsed: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("groupTemplatesByCategory", () => {
  it("groups by category, then lifecycle event, then the set of channels present", () => {
    const templates = [
      makeTemplate({ category: "Onboarding", typeName: "Welcome", channel: "email", variant: "A" }),
      makeTemplate({ category: "Onboarding", typeName: "Welcome", channel: "email", variant: "B" }),
      makeTemplate({ category: "Onboarding", typeName: "Welcome", channel: "sms", variant: "A" }),
      makeTemplate({ category: "Billing & Payments", typeName: "Payment Failed", channel: "push", variant: "A" }),
    ];

    const grouped = groupTemplatesByCategory(templates);

    expect([...grouped.keys()]).toEqual(["Onboarding", "Billing & Payments"]);
    expect([...grouped.get("Onboarding")!.keys()]).toEqual(["Welcome"]);
    // Two rows share (typeName, channel="email") differing only by variant —
    // the channel set collapses them to one entry, exactly what the channel
    // picker needs (variant fan-out is a separate concern).
    expect(grouped.get("Onboarding")!.get("Welcome")).toEqual(new Set(["email", "sms"]));
    expect(grouped.get("Billing & Payments")!.get("Payment Failed")).toEqual(new Set(["push"]));
  });

  it("returns an empty map for an empty template list", () => {
    expect(groupTemplatesByCategory([]).size).toBe(0);
  });
});

describe("channelsForEvent", () => {
  it("finds the channel set for a lifecycle event regardless of which category it's under", () => {
    const grouped = groupTemplatesByCategory([
      makeTemplate({ category: "Onboarding", typeName: "Welcome", channel: "email" }),
      makeTemplate({ category: "Onboarding", typeName: "Welcome", channel: "push" }),
      makeTemplate({ category: "Billing & Payments", typeName: "Payment Failed", channel: "sms" }),
    ]);

    expect(channelsForEvent(grouped, "Welcome").sort()).toEqual(["email", "push"]);
    expect(channelsForEvent(grouped, "Payment Failed")).toEqual(["sms"]);
  });

  it("returns an empty array for an event that isn't in the map", () => {
    const grouped = groupTemplatesByCategory([makeTemplate({})]);
    expect(channelsForEvent(grouped, "Nonexistent Event")).toEqual([]);
  });
});
