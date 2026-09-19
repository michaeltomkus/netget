import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchMessage, isChannelConfigured } from "./providers.js";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.endsWith("_PROVIDER_WEBHOOK_URL") || key.endsWith("_PROVIDER_API_KEY")) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

beforeEach(() => {
  resetEnv();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  resetEnv();
  vi.unstubAllGlobals();
});

describe("isChannelConfigured", () => {
  it("is false when the channel's webhook URL env var is unset", () => {
    delete process.env.EMAIL_PROVIDER_WEBHOOK_URL;
    expect(isChannelConfigured("email")).toBe(false);
  });

  it("is true once the channel's webhook URL env var is set", () => {
    process.env.SMS_PROVIDER_WEBHOOK_URL = "https://example.com/sms";
    expect(isChannelConfigured("sms")).toBe(true);
  });
});

describe("dispatchMessage", () => {
  it("throws without calling fetch when the channel isn't configured", async () => {
    delete process.env.PUSH_PROVIDER_WEBHOOK_URL;
    await expect(dispatchMessage("push", { to: "device-1", body: "hi" })).rejects.toThrow(
      /push provider not configured/i,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("POSTs the payload with a Bearer token when an API key is set", async () => {
    process.env.EMAIL_PROVIDER_WEBHOOK_URL = "https://example.com/email";
    process.env.EMAIL_PROVIDER_API_KEY = "secret-key";
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

    await dispatchMessage("email", { to: "a@example.com", subject: "Hi", body: "Body text" });

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer secret-key",
        }),
        body: JSON.stringify({ to: "a@example.com", subject: "Hi", body: "Body text" }),
      }),
    );
  });

  it("omits the Authorization header when no API key is configured", async () => {
    process.env.EMAIL_PROVIDER_WEBHOOK_URL = "https://example.com/email";
    delete process.env.EMAIL_PROVIDER_API_KEY;
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

    await dispatchMessage("email", { to: "a@example.com", body: "Body text" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("throws with the status and body when the provider responds non-ok", async () => {
    process.env.SMS_PROVIDER_WEBHOOK_URL = "https://example.com/sms";
    vi.mocked(fetch).mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(dispatchMessage("sms", { to: "+15555550100", body: "hi" })).rejects.toThrow(
      /sms provider request failed: 429/i,
    );
  });
});
