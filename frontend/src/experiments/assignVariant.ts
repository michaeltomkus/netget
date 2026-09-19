// Deterministic, equal-weighted variant assignment — pure function of
// (experimentKey, subjectId), so the same subject always lands in the same
// bucket for a given experiment without any server round trip or stored
// assignment record. FNV-1a is not cryptographic — it doesn't need to be,
// this only has to be a stable, well-distributed hash, not tamper-resistant.
function hashToUnitInterval(input: string): number {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296; // unsigned 32-bit -> [0, 1)
}

export function assignVariant<V extends string>(experimentKey: string, subjectId: string, variants: readonly V[]): V {
  const fraction = hashToUnitInterval(`${experimentKey}:${subjectId}`);
  const index = Math.min(Math.floor(fraction * variants.length), variants.length - 1);
  return variants[index];
}
