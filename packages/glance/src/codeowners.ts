/**
 * Section headers of a GitLab CODEOWNERS file: a line whose first non-blank
 * character opens a bracket, optionally prefixed with `^` for an optional
 * section. The approvals-count suffix (`[Name][2]`) and trailing default
 * owners are not part of the name. Names are kept verbatim: GitLab matches
 * sections case-insensitively for ownership, but the approval rule's
 * `section` carries the header text and consumers match that exactly.
 */
export function parseCodeownerSections(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\^?\[([^\]]*)\]/.exec(raw.trimStart());
    if (!m) continue;
    const name = m[1]!.trim();
    if (name.length > 0) out.add(name);
  }
  return [...out].sort();
}
