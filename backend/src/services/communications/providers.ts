import type { CommunicationChannel } from "../../types.js";

// Generic, provider-agnostic outbound dispatch — one plain HTTPS POST per
// channel, same "avoid SDK weight" call as Azure TTS (see
// services/tts/azureNeuralTts.ts): most transactional email/SMS/push
// vendors (Resend, Postmark, Twilio, a push gateway) accept a simple JSON
// webhook POST, so there's no need to pull in three separate vendor SDKs
// for something this app can't even live-test in this environment. Wiring
// a specific vendor later is an env-var change, not a code change.

function envUrl(channel: CommunicationChannel): string | undefined {
  return process.env[`${channel.toUpperCase()}_PROVIDER_WEBHOOK_URL`];
}

function envKey(channel: CommunicationChannel): string | undefined {
  return process.env[`${channel.toUpperCase()}_PROVIDER_API_KEY`];
}

export function isChannelConfigured(channel: CommunicationChannel): boolean {
  return Boolean(envUrl(channel));
}

export interface DispatchPayload {
  to: string;
  subject?: string;
  body: string;
}

/**
 * Sends one message. Throws if the channel isn't configured (no
 * `*_PROVIDER_WEBHOOK_URL` set) or the provider call fails — callers catch
 * this and record a `skipped_no_provider` / `failed` CommunicationSend row
 * rather than letting one recipient's failure abort the whole batch. Same
 * graceful-degradation posture as attachQuestionAudio/TTS: this app works
 * fully without any messaging provider configured, it just doesn't
 * actually deliver anything yet.
 */
export async function dispatchMessage(channel: CommunicationChannel, payload: DispatchPayload): Promise<void> {
  const url = envUrl(channel);
  if (!url) {
    throw new Error(`${channel} provider not configured (set ${channel.toUpperCase()}_PROVIDER_WEBHOOK_URL)`);
  }
  const key = envKey(channel);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${channel} provider request failed: ${res.status} ${detail}`);
  }
}
