import { beforeEach, describe, expect, it, vi } from "vitest";
import seedData from "./seedTemplates.data.json" with { type: "json" };

const upsertCommunicationTemplate = vi.fn().mockResolvedValue(undefined);

vi.mock("../../db/store.js", () => ({
  store: {
    upsertCommunicationTemplate: (...args: [unknown]) => upsertCommunicationTemplate(...args),
  },
}));

const { seedCommunicationTemplates } = await import("./seedTemplates.js");

beforeEach(() => {
  upsertCommunicationTemplate.mockClear();
});

describe("seedCommunicationTemplates", () => {
  it("upserts every row in the static seed data and returns its count", async () => {
    const count = await seedCommunicationTemplates();

    expect(count).toBe(seedData.length);
    expect(upsertCommunicationTemplate).toHaveBeenCalledTimes(seedData.length);
  });

  it("passes each row's fields through, converting a null subject (sms rows) to undefined", async () => {
    await seedCommunicationTemplates();

    const smsRow = seedData.find((r: { channel: string }) => r.channel === "sms")!;
    const emailRow = seedData.find((r: { channel: string }) => r.channel === "email")!;

    expect(upsertCommunicationTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        key: smsRow.key,
        typeName: smsRow.typeName,
        category: smsRow.category,
        channel: "sms",
        variant: smsRow.variant,
        subject: undefined,
        body: smsRow.body,
        variablesUsed: smsRow.variablesUsed,
      }),
    );
    expect(upsertCommunicationTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ key: emailRow.key, subject: emailRow.subject }),
    );
  });

  it("is safe to call twice — a second call re-upserts the same keys, not new rows", async () => {
    await seedCommunicationTemplates();
    upsertCommunicationTemplate.mockClear();
    const secondCount = await seedCommunicationTemplates();

    expect(secondCount).toBe(seedData.length);
    const keysUpserted = upsertCommunicationTemplate.mock.calls.map((call) => call[0].key);
    expect(new Set(keysUpserted).size).toBe(seedData.length);
  });
});
