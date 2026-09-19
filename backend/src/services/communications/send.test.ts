import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationTemplate, User } from "../../types.js";

const listCommunicationTemplates = vi.fn<() => Promise<CommunicationTemplate[]>>();
const listUsers = vi.fn<() => Promise<User[]>>();
const listActiveSubscriptions = vi.fn<() => Promise<{ userId: string }[]>>();
const createCommunicationSends = vi.fn<(rows: unknown[]) => Promise<void>>();

vi.mock("../../db/store.js", () => ({
  store: {
    listCommunicationTemplates: (...args: []) => listCommunicationTemplates(...args),
    listUsers: (...args: []) => listUsers(...args),
    listActiveSubscriptions: (...args: []) => listActiveSubscriptions(...args),
    createCommunicationSends: (...args: [unknown[]]) => createCommunicationSends(...args),
  },
}));

const isChannelConfigured = vi.fn<(channel: string) => boolean>();
const dispatchMessage = vi.fn<(channel: string, payload: unknown) => Promise<void>>();

vi.mock("./providers.js", () => ({
  isChannelConfigured: (...args: [string]) => isChannelConfigured(...args),
  dispatchMessage: (...args: [string, unknown]) => dispatchMessage(...args),
}));

const getEffectiveBrandVariant = vi.fn<
  () => Promise<{ name: string; tagline: string; description: string; footerTagline: string }>
>();
vi.mock("../brand.js", () => ({
  getEffectiveBrandVariant: (...args: []) => getEffectiveBrandVariant(...args),
}));

const { sendCommunication } = await import("./send.js");

function makeTemplate(overrides: Partial<CommunicationTemplate>): CommunicationTemplate {
  return {
    id: overrides.variant === "B" ? "tpl-b" : "tpl-a",
    key: "welcome-onboarding-email-a",
    typeName: "Welcome / Onboarding",
    category: "Onboarding",
    channel: "email",
    variant: "A",
    subject: "Welcome, {first_name}!",
    body: "Hi {first_name}, welcome to {app_name}.",
    variablesUsed: ["first_name", "app_name"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeUser(id: string, email: string): User {
  return { id, clerkUserId: `clerk_${id}`, email, role: "user", createdAt: new Date().toISOString() };
}

beforeEach(() => {
  listCommunicationTemplates.mockReset();
  listUsers.mockReset();
  listActiveSubscriptions.mockReset();
  createCommunicationSends.mockReset();
  isChannelConfigured.mockReset();
  dispatchMessage.mockReset();
  getEffectiveBrandVariant.mockReset().mockResolvedValue({
    name: "InterviewAI",
    tagline: "mock interview practice",
    description: "desc",
    footerTagline: "footer",
  });
});

describe("sendCommunication", () => {
  it("throws when no template exists for the (typeName, channel) pair", async () => {
    listCommunicationTemplates.mockResolvedValue([]);
    await expect(
      sendCommunication({ typeName: "Nope", channel: "email", audience: { kind: "all" }, sentByUserId: "admin_1" }),
    ).rejects.toThrow(/No template found/);
  });

  it("uses whichever brand variant is currently effective (e.g. an admin override) for {app_name}", async () => {
    listCommunicationTemplates.mockResolvedValue([makeTemplate({ variant: "A" })]);
    listUsers.mockResolvedValue([makeUser("u1", "a@example.com")]);
    isChannelConfigured.mockReturnValue(false);
    getEffectiveBrandVariant.mockResolvedValue({
      name: "PrepPilot",
      tagline: "t",
      description: "d",
      footerTagline: "f",
    });

    const summary = await sendCommunication({
      typeName: "Welcome / Onboarding",
      channel: "email",
      audience: { kind: "all" },
      sentByUserId: "admin_1",
    });

    expect(createCommunicationSends).toHaveBeenCalledWith([
      expect.objectContaining({ renderedBody: expect.stringContaining("welcome to PrepPilot") }),
    ]);
    expect(summary.results).toHaveLength(1);
  });

  it("sends to every user for audience 'all', rendering merge fields", async () => {
    listCommunicationTemplates.mockResolvedValue([makeTemplate({ variant: "A" })]);
    listUsers.mockResolvedValue([makeUser("u1", "a@example.com"), makeUser("u2", "b@example.com")]);
    isChannelConfigured.mockReturnValue(true);
    dispatchMessage.mockResolvedValue(undefined);

    const summary = await sendCommunication({
      typeName: "Welcome / Onboarding",
      channel: "email",
      audience: { kind: "all" },
      sentByUserId: "admin_1",
    });

    expect(summary.results).toHaveLength(2);
    expect(summary.results.every((r) => r.status === "sent")).toBe(true);
    expect(dispatchMessage).toHaveBeenCalledTimes(2);
    expect(dispatchMessage).toHaveBeenCalledWith(
      "email",
      expect.objectContaining({ to: "a@example.com", body: expect.stringContaining("welcome to InterviewAI") }),
    );
    expect(createCommunicationSends).toHaveBeenCalledTimes(1);
    const rows = createCommunicationSends.mock.calls[0][0] as { batchId: string }[];
    expect(new Set(rows.map((r) => r.batchId)).size).toBe(1);
  });

  it("resolves a 'single' audience by email, case-insensitively, and is empty for no match", async () => {
    listCommunicationTemplates.mockResolvedValue([makeTemplate({ variant: "A" })]);
    listUsers.mockResolvedValue([makeUser("u1", "Someone@Example.com")]);
    isChannelConfigured.mockReturnValue(false);

    const found = await sendCommunication({
      typeName: "Welcome / Onboarding",
      channel: "email",
      audience: { kind: "single", email: "someone@example.com" },
      sentByUserId: "admin_1",
    });
    expect(found.results).toHaveLength(1);

    const notFound = await sendCommunication({
      typeName: "Welcome / Onboarding",
      channel: "email",
      audience: { kind: "single", email: "nobody@example.com" },
      sentByUserId: "admin_1",
    });
    expect(notFound.results).toHaveLength(0);
  });

  it("filters to active subscribers only", async () => {
    listCommunicationTemplates.mockResolvedValue([makeTemplate({ variant: "A" })]);
    listUsers.mockResolvedValue([makeUser("u1", "a@example.com"), makeUser("u2", "b@example.com")]);
    listActiveSubscriptions.mockResolvedValue([{ userId: "u2" }]);
    isChannelConfigured.mockReturnValue(false);

    const summary = await sendCommunication({
      typeName: "Welcome / Onboarding",
      channel: "email",
      audience: { kind: "active_subscribers" },
      sentByUserId: "admin_1",
    });
    expect(summary.results).toEqual([expect.objectContaining({ userId: "u2" })]);
  });

  it("records skipped_no_provider without calling dispatch when the channel isn't configured", async () => {
    listCommunicationTemplates.mockResolvedValue([makeTemplate({ variant: "A" })]);
    listUsers.mockResolvedValue([makeUser("u1", "a@example.com")]);
    isChannelConfigured.mockReturnValue(false);

    const summary = await sendCommunication({
      typeName: "Welcome / Onboarding",
      channel: "email",
      audience: { kind: "all" },
      sentByUserId: "admin_1",
    });
    expect(summary.configured).toBe(false);
    expect(summary.results[0].status).toBe("skipped_no_provider");
    expect(dispatchMessage).not.toHaveBeenCalled();
  });

  it("records a failed send with the error message when the provider call throws", async () => {
    listCommunicationTemplates.mockResolvedValue([makeTemplate({ variant: "A" })]);
    listUsers.mockResolvedValue([makeUser("u1", "a@example.com")]);
    isChannelConfigured.mockReturnValue(true);
    dispatchMessage.mockRejectedValue(new Error("provider unreachable"));

    const summary = await sendCommunication({
      typeName: "Welcome / Onboarding",
      channel: "email",
      audience: { kind: "all" },
      sentByUserId: "admin_1",
    });
    expect(summary.results[0]).toEqual(
      expect.objectContaining({ status: "failed", error: "provider unreachable" }),
    );
  });

  it("deterministically splits an audience across two variants of the same (typeName, channel)", async () => {
    listCommunicationTemplates.mockResolvedValue([
      makeTemplate({ variant: "A" }),
      makeTemplate({ variant: "B", id: "tpl-b", subject: "B subject" }),
    ]);
    const users = Array.from({ length: 30 }, (_, i) => makeUser(`u${i}`, `u${i}@example.com`));
    listUsers.mockResolvedValue(users);
    isChannelConfigured.mockReturnValue(false);

    const first = await sendCommunication({
      typeName: "Welcome / Onboarding",
      channel: "email",
      audience: { kind: "all" },
      sentByUserId: "admin_1",
    });
    const variantByUser = new Map(first.results.map((r) => [r.userId, r.variant]));
    const usedBoth = new Set(first.results.map((r) => r.variant));
    expect(usedBoth.size).toBe(2);

    const second = await sendCommunication({
      typeName: "Welcome / Onboarding",
      channel: "email",
      audience: { kind: "all" },
      sentByUserId: "admin_1",
    });
    for (const r of second.results) {
      expect(r.variant).toBe(variantByUser.get(r.userId));
    }
  });
});
