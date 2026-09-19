import { describe, expect, it } from "vitest";
import { extractVariables, renderTemplate } from "./template.js";

describe("extractVariables", () => {
  it("finds every distinct {var} token", () => {
    expect(extractVariables("Hi {first_name}, welcome to {app_name}! {first_name} again.")).toEqual([
      "app_name",
      "first_name",
    ]);
  });

  it("returns an empty array when there are none", () => {
    expect(extractVariables("No tokens here.")).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("substitutes every provided variable", () => {
    expect(renderTemplate("Hi {first_name}, from {app_name}.", { first_name: "Sam", app_name: "InterviewAI" })).toBe(
      "Hi Sam, from InterviewAI.",
    );
  });

  it("leaves an unresolved token visible rather than blanking it", () => {
    expect(renderTemplate("Hi {first_name}, {missing_var} stays.", { first_name: "Sam" })).toBe(
      "Hi Sam, {missing_var} stays.",
    );
  });
});
