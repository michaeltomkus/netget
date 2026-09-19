import type { CommunicationChannel, CommunicationTemplate } from "../api/types";

/** category -> lifecycle event (typeName) -> the set of channels that have copy for it. */
export type TemplatesByCategory = Map<string, Map<string, Set<CommunicationChannel>>>;

/** Groups a flat template list the way the composer's event/channel pickers need it. */
export function groupTemplatesByCategory(templates: CommunicationTemplate[]): TemplatesByCategory {
  const byCategory: TemplatesByCategory = new Map();
  for (const t of templates) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, new Map());
    const events = byCategory.get(t.category)!;
    if (!events.has(t.typeName)) events.set(t.typeName, new Set());
    events.get(t.typeName)!.add(t.channel);
  }
  return byCategory;
}

/** Which channels have copy for a given lifecycle event, searching across every category. */
export function channelsForEvent(byCategory: TemplatesByCategory, typeName: string): CommunicationChannel[] {
  for (const events of byCategory.values()) {
    const channels = events.get(typeName);
    if (channels) return [...channels];
  }
  return [];
}
