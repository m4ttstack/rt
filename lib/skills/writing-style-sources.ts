import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { reconcileSkillLinks, type ReconcileResult } from "./link.ts";
import { stripFrontmatter } from "./sources.ts";
import { WRITING_STYLE_PRESETS, isPresetId, type ResolvedWritingStyle } from "./writing-style.ts";

export interface PluginEntry {
  id: string;
  enabled: boolean;
  installPath: string | null;
}

export function parsePluginEntries(stdout: string): PluginEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: PluginEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") return null;
    const e = item as { id: string; enabled?: unknown; installPath?: unknown };
    out.push({ id: e.id, enabled: e.enabled === true, installPath: typeof e.installPath === "string" ? e.installPath : null });
  }
  return out;
}

function childDirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function skillDirNames(root: string): string[] {
  return childDirs(root).filter((name) => existsSync(join(root, name, "SKILL.md")));
}

/** Mirrors Claude Code: the manifest's `skills` roots, each scanned one level deep; `./skills` when absent. */
function pluginSkillRoots(installPath: string): string[] {
  let roots: string[] = ["./skills"];
  try {
    const manifest = JSON.parse(readFileSync(join(installPath, ".claude-plugin", "plugin.json"), "utf8")) as { skills?: unknown };
    if (typeof manifest.skills === "string") roots = [manifest.skills];
    else if (Array.isArray(manifest.skills)) roots = manifest.skills.filter((r): r is string => typeof r === "string");
  } catch {
    // an unreadable manifest still gets the default root
  }
  return roots.map((r) => resolve(installPath, r));
}

export function personalSkillsDir(home: string): string {
  return join(home, ".mattstack", "user", "skills");
}

export interface SkillInventory {
  installed: Set<string>;
  disabledPluginFor: Map<string, string>;
  personal: { name: string; dir: string }[];
}

function frontmatterName(dir: string): string | null {
  try {
    const name = stripFrontmatter(readFileSync(join(dir, "SKILL.md"), "utf8")).frontmatter.name;
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

export function readSkillInventory(home: string, plugins: PluginEntry[] | null): SkillInventory {
  const installed = new Set<string>();
  const disabledPluginFor = new Map<string, string>();

  const claudeSkills = join(home, ".claude", "skills");
  for (const name of skillDirNames(claudeSkills)) installed.add(name);

  for (const plugin of plugins ?? []) {
    if (!plugin.installPath) continue;
    const pluginName = plugin.id.split("@")[0]!;
    for (const root of pluginSkillRoots(plugin.installPath)) {
      for (const dir of skillDirNames(root)) {
        const id = `${pluginName}:${dir}`;
        if (plugin.enabled) {
          installed.add(id);
          disabledPluginFor.delete(id);
        } else if (!installed.has(id)) {
          disabledPluginFor.set(id, plugin.id);
        }
      }
    }
  }

  const personalRoot = personalSkillsDir(home);
  const personal = skillDirNames(personalRoot).flatMap((dirName) => {
    const dir = join(personalRoot, dirName);
    const name = frontmatterName(dir);
    return name ? [{ name, dir }] : [];
  });

  return { installed, disabledPluginFor, personal };
}

export function isStyleUsable(id: string, inv: SkillInventory): boolean {
  return isPresetId(id) || inv.installed.has(id);
}

export interface WritingStyleOption {
  id: string;
  label: string;
  detail: string;
  sample?: string;
  kind: "preset" | "personal" | "installed";
  installed: boolean;
}

// options are always the three catalog presets; every personal style and every installed
// skill with "writing-style" in its id is a suggestion to type instead, never an option.
export function listWritingStyles(inv: SkillInventory, current: ResolvedWritingStyle): { current: ResolvedWritingStyle; options: WritingStyleOption[]; suggestions: WritingStyleOption[] } {
  const options: WritingStyleOption[] = WRITING_STYLE_PRESETS.map((p) => ({
    id: p.id, label: p.label, detail: p.detail, sample: p.sample, kind: "preset", installed: inv.installed.has(p.id),
  }));
  const seen = new Set(options.map((o) => o.id));
  const suggestions: WritingStyleOption[] = [];
  for (const s of inv.personal) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    suggestions.push({ id: s.name, label: s.name, detail: "Your own style, in your home repo", kind: "personal", installed: inv.installed.has(s.name) });
  }
  for (const id of [...inv.installed].sort()) {
    if (seen.has(id) || !id.includes("writing-style")) continue;
    seen.add(id);
    suggestions.push({ id, label: id, detail: "An installed skill", kind: "installed", installed: true });
  }
  return { current, options, suggestions };
}

/** Links only into ~/.claude/skills and only prunes links pointing into the personal directory. */
export function linkPersonalSkills(home: string): ReconcileResult | null {
  const dir = personalSkillsDir(home);
  if (!existsSync(dir)) return null;
  return reconcileSkillLinks({ skillsDir: dir, claudeSkillsDir: join(home, ".claude", "skills") });
}
