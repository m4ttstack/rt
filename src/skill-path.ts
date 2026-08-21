// src/skill-path.ts
import { existsSync, readdirSync, realpathSync } from "fs";
import { join } from "path";

export interface PluginEntry {
  id: string;
  enabled?: boolean;
  installPath: string;
}

export type PluginListRunner = () => Promise<PluginEntry[]>;

let cachedPlugins: PluginEntry[] | null = null;

/** `claude plugin list --json`, memoized for the life of the process (the
    board only picks up newly (un)installed plugins on restart anyway). */
export const defaultPluginListRunner: PluginListRunner = async () => {
  if (cachedPlugins) return cachedPlugins;
  try {
    const proc = Bun.spawn(["claude", "plugin", "list", "--json"], { stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return (cachedPlugins = []);
    const parsed = JSON.parse(out);
    cachedPlugins = Array.isArray(parsed) ? parsed : [];
  } catch {
    cachedPlugins = [];
  }
  return cachedPlugins;
};

/** Find a SKILL.md directly under `dir`. */
function skillMdIn(dir: string): string | null {
  const path = join(dir, "SKILL.md");
  return existsSync(path) ? path : null;
}

/**
 * Resolve a fully-qualified skill name ("<plugin>:<skill>", e.g.
 * "acme:mr-board-review") to the absolute path of its SKILL.md,
 * mirroring loadAttachment's search order (repo-tools lib/skills/sources.ts):
 * skills/<name>/SKILL.md, then skills/*<name>/SKILL.md (one category level),
 * then attachments/<name>/SKILL.md. The plugin itself is found via
 * `claude plugin list --json`, matching the first enabled entry whose id
 * starts with "<plugin>@".
 *
 * Never throws -- any failure (malformed name, no matching plugin, missing
 * install dir, skill not found anywhere) returns null so callers can fall
 * back to the historical slash-invocation form.
 */
export async function resolveSkillPath(
  name: string,
  listPlugins: PluginListRunner = defaultPluginListRunner,
): Promise<string | null> {
  try {
    const colon = name.indexOf(":");
    if (colon <= 0 || colon === name.length - 1) return null;
    const pluginPrefix = name.slice(0, colon);
    const skillName = name.slice(colon + 1);

    const plugins = await listPlugins();
    const plugin = plugins.find((p) => p.enabled !== false && p.id.startsWith(`${pluginPrefix}@`));
    if (!plugin?.installPath) return null;

    const root = realpathSync(plugin.installPath);

    const direct = skillMdIn(join(root, "skills", skillName));
    if (direct) return realpathSync(direct);

    const skillsDir = join(root, "skills");
    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nested = skillMdIn(join(skillsDir, entry.name, skillName));
        if (nested) return realpathSync(nested);
      }
    }

    const attachment = skillMdIn(join(root, "attachments", skillName));
    if (attachment) return realpathSync(attachment);

    return null;
  } catch {
    return null;
  }
}
