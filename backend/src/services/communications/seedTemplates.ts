import seedData from "./seedTemplates.data.json" with { type: "json" };
import { store } from "../../db/store.js";
import type { CommunicationChannel } from "../../types.js";

interface SeedRow {
  key: string;
  typeName: string;
  category: string;
  channel: CommunicationChannel;
  variant: string;
  subject: string | null;
  body: string;
  variablesUsed: string[];
}

const SEED_ROWS = seedData as SeedRow[];

/**
 * Upserts the reference set of lifecycle communication templates (25 event
 * types x 3 channels x 2 A/B copy variants = 150 rows) — the starting
 * library an admin composes from, not content this app invents itself.
 * Safe to call repeatedly: each row upserts by its stable `key`, so a
 * second call is a no-op unless the seed data itself changed.
 */
export async function seedCommunicationTemplates(): Promise<number> {
  for (const row of SEED_ROWS) {
    await store.upsertCommunicationTemplate({
      key: row.key,
      typeName: row.typeName,
      category: row.category,
      channel: row.channel,
      variant: row.variant,
      subject: row.subject ?? undefined,
      body: row.body,
      variablesUsed: row.variablesUsed,
    });
  }
  return SEED_ROWS.length;
}
