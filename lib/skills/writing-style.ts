import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getSetting, type Resolved } from "../settings/resolve.ts";

export const WRITING_STYLE_KEY = "skills.writingStyle";
export const FALLBACK_WRITING_STYLE = "mattstack:writing-style-conversational";

export interface WritingStylePreset {
  id: string;
  label: string;
  detail: string;
  sample: string;
}

export const WRITING_STYLE_PRESETS: readonly WritingStylePreset[] = [
  {
    id: "mattstack:writing-style-sparse",
    label: "Sparse",
    detail: "Terse, lowercase for technical points, one tight paragraph per finding.",
    sample: "**issue:** cache is keyed on userId alone, so two tenants share an entry. key on (tenant, id)?",
  },
  {
    id: "mattstack:writing-style-conversational",
    label: "Conversational",
    detail: "Short, friendly sentences in sentence case, like talking to a teammate.",
    sample: "**issue:** The cache is keyed on userId alone, so two tenants can share an entry. Could we key on both?",
  },
  {
    id: "mattstack:writing-style-structured",
    label: "Structured",
    detail: "Labelled lines and short bullets for teams that like formal write-ups.",
    sample: "**issue:** Settings leak across tenants. Why: the cache key omits the tenant. Suggestion: key on (tenant, id).",
  },
];

export type WritingStyleSource = "user" | "team" | "preferences" | "fallback";

export interface ResolvedWritingStyle {
  skill: string;
  source: WritingStyleSource;
}

const SKILL_ID_RE = /^[a-z0-9][a-z0-9._-]*(:[a-z0-9._-]+)?$/;

export function isValidSkillId(id: string): boolean {
  return SKILL_ID_RE.test(id);
}

export function presetById(id: string): WritingStylePreset | undefined {
  return WRITING_STYLE_PRESETS.find((p) => p.id === id);
}

export function isPresetId(id: string): boolean {
  return presetById(id) !== undefined;
}

export function preferencesPath(home: string): string {
  return join(home, ".mattstack", "user", "skills", "preferences.md");
}

export function parsePreferencesStyle(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === "## writing style");
  if (start === -1) return null;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) return null;
    const m = /^\s*writing-style:\s*`?([^`\s]+)`?\s*$/.exec(line);
    if (m) return isValidSkillId(m[1]!) ? m[1]! : null;
  }
  return null;
}

export function resolveWritingStyle(opts: { home?: string; read?: (key: string) => Resolved<unknown> } = {}): ResolvedWritingStyle {
  const home = opts.home ?? process.env.HOME ?? "";
  const read = opts.read ?? ((key: string) => getSetting<unknown>(key));

  const configured = read(WRITING_STYLE_KEY);
  if (typeof configured.value === "string" && isValidSkillId(configured.value)) {
    const scope = configured.provenance.at(-1)?.scope;
    return { skill: configured.value, source: scope === "team" ? "team" : "user" };
  }

  const path = preferencesPath(home);
  const fromPreferences = existsSync(path) ? parsePreferencesStyle(readFileSync(path, "utf8")) : null;
  if (fromPreferences) return { skill: fromPreferences, source: "preferences" };

  return { skill: FALLBACK_WRITING_STYLE, source: "fallback" };
}
