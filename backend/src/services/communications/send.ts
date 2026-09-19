import { v4 as uuidv4 } from "uuid";
import { store } from "../../db/store.js";
import { renderTemplate } from "./template.js";
import { dispatchMessage, isChannelConfigured } from "./providers.js";
import { getEffectiveBrandVariant } from "../brand.js";
import type {
  CommunicationChannel,
  CommunicationSendResult,
  CommunicationSendStatus,
  CommunicationTemplate,
  User,
} from "../../types.js";

export type AudienceSelector =
  | { kind: "single"; email: string }
  | { kind: "all" }
  | { kind: "active_subscribers" };

async function resolveAudience(selector: AudienceSelector): Promise<User[]> {
  switch (selector.kind) {
    case "single": {
      const match = await store.getUserByEmail(selector.email);
      return match ? [match] : [];
    }
    case "active_subscribers":
      return store.listActiveSubscriberUsers();
    case "all":
      return store.listUsers();
  }
}

// FNV-1a, mirroring frontend/src/experiments/assignVariant.ts's algorithm —
// deterministic per (template group, user), so re-running a send against
// the same audience reproduces the same A/B split instead of reshuffling
// who got which variant on every call.
function hashToUnit(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

/** `sortedVariants` must already be sorted (see call site) — the same order is reused for every recipient in a batch, so sorting once per batch instead of once per recipient avoids an identical re-sort per person on a send. */
function pickVariant(sortedVariants: CommunicationTemplate[], userId: string): CommunicationTemplate {
  if (sortedVariants.length === 1) return sortedVariants[0];
  const bucket = Math.min(
    Math.floor(hashToUnit(`${sortedVariants[0].typeName}:${sortedVariants[0].channel}:${userId}`) * sortedVariants.length),
    sortedVariants.length - 1,
  );
  return sortedVariants[bucket];
}

export interface SendCommunicationParams {
  typeName: string;
  channel: CommunicationChannel;
  audience: AudienceSelector;
  /** Per-recipient merge-field overrides layered on top of the built-in ones (email, first_name, app_name). */
  extraVars?: Record<string, string>;
  sentByUserId: string;
}

export interface SendCommunicationSummary {
  batchId: string;
  configured: boolean;
  results: CommunicationSendResult[];
}

/**
 * Sends one lifecycle communication (a `typeName` + `channel` pair) to a
 * resolved audience, splitting recipients across that pair's A/B template
 * variants (or using the single variant if only one exists). Every attempt
 * — sent, skipped (no provider configured), or failed — is written to
 * CommunicationSend, so this is also the app's full send audit log.
 */
export async function sendCommunication(params: SendCommunicationParams): Promise<SendCommunicationSummary> {
  const allTemplates = await store.listCommunicationTemplates();
  const variants = allTemplates.filter((t) => t.typeName === params.typeName && t.channel === params.channel);
  if (variants.length === 0) {
    throw new Error(`No template found for "${params.typeName}" on channel "${params.channel}"`);
  }
  // Sorted once here, not once per recipient — pickVariant reuses this same order for every recipient in the batch.
  const sortedVariants = [...variants].sort((a, b) => a.variant.localeCompare(b.variant));

  const recipients = await resolveAudience(params.audience);
  const batchId = uuidv4();
  const configured = isChannelConfigured(params.channel);
  // Resolved once per batch, not per recipient — every message in one send
  // uses whichever brand name is in effect right now (an admin override if
  // set, else the default variant; see services/brand.ts).
  const brandName = (await getEffectiveBrandVariant()).name;

  const outcomes = await Promise.all(
    recipients.map(async (user) => {
      const template = pickVariant(sortedVariants, user.id);
      const vars: Record<string, string> = {
        email: user.email,
        first_name: user.name?.split(" ")[0] ?? user.email.split("@")[0],
        app_name: brandName,
        ...params.extraVars,
      };
      const renderedSubject = template.subject ? renderTemplate(template.subject, vars) : undefined;
      const renderedBody = renderTemplate(template.body, vars);

      let status: CommunicationSendStatus = "skipped_no_provider";
      let error: string | undefined;
      if (configured) {
        try {
          await dispatchMessage(params.channel, { to: user.email, subject: renderedSubject, body: renderedBody });
          status = "sent";
        } catch (err) {
          status = "failed";
          error = err instanceof Error ? err.message : String(err);
          console.warn(`Communication send failed for user ${user.id}: ${error}`);
        }
      }

      return { user, template, renderedSubject, renderedBody, status, error };
    }),
  );

  await store.createCommunicationSends(
    outcomes.map((o) => ({
      templateId: o.template.id,
      userId: o.user.id,
      channel: params.channel,
      variant: o.template.variant,
      status: o.status,
      renderedSubject: o.renderedSubject,
      renderedBody: o.renderedBody,
      error: o.error,
      sentByUserId: params.sentByUserId,
      batchId,
    })),
  );

  return {
    batchId,
    configured,
    results: outcomes.map((o) => ({
      userId: o.user.id,
      email: o.user.email,
      templateId: o.template.id,
      variant: o.template.variant,
      status: o.status,
      error: o.error,
    })),
  };
}
