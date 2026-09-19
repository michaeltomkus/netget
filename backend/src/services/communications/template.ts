const VARIABLE_PATTERN = /\{(\w+)\}/g;

/** All distinct `{variable}` names referenced in a piece of template text. */
export function extractVariables(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

/**
 * Substitutes `{variable}` tokens from `vars`. A token with no matching key
 * is left in place rather than removed — a silently blanked merge field
 * (e.g. a typo'd `{fist_name}`) is far more likely to slip through review
 * unnoticed than a literal `{fist_name}` left visible in a preview.
 */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(VARIABLE_PATTERN, (whole, key: string) => vars[key] ?? whole);
}
