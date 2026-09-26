/**
 * Section headers of a GitLab CODEOWNERS file: a line whose first non-blank
 * character opens a bracket, optionally prefixed with `^` for an optional
 * section. The approvals-count suffix (`[Name][2]`) and trailing default
 * owners are not part of the name. GitLab merges same-named sections
 * case-insensitively and keeps the first heading's casing, so this does too;
 * the kept text is what the approval rule's `section` carries and what
 * consumers match exactly.
 */
export function parseCodeownerSections(text: string): string[] {
  const byKey = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\^?\[([^\]]*)\]/.exec(raw.trimStart());
    if (!m) continue;
    const name = m[1]!.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()].sort();
}
