/**
 * rt skills writing-style -- show, list, choose, or start the voice for
 * prose posted under your name (MR descriptions, commit messages, replies).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import { homeGitDir } from "../lib/setup/steps/home.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, userErrorPayload } from "../lib/setup/errors.ts";
import { execWithTimeout } from "../lib/setup/probes.ts";
import { setSetting } from "../lib/settings/write.ts";
import { isValidSkillId, presetById, resolveWritingStyle, WRITING_STYLE_KEY, WRITING_STYLE_SOURCE_LABEL, type ResolvedWritingStyle } from "../lib/skills/writing-style.ts";
import { isStyleUsable, linkPersonalSkills, listWritingStyles, parsePluginEntries, personalSkillsDir, pluginSkillRoots, readSkillInventory } from "../lib/skills/writing-style-sources.ts";
import type { CommandContext } from "../lib/command-tree.ts";

export interface WritingStyleDeps {
  home: () => string;
  now: () => Date;
  print: (s: string) => void;
  exit: (code: number) => never;
  isTTY: () => boolean;
  pick: (message: string, options: { value: string; label: string; hint?: string }[]) => Promise<string | null>;
  prompt: (message: string) => Promise<string | null>;
  pluginListStdout: () => Promise<string | null>;
  writeSetting: (key: string, value: unknown, scope: "user" | "team") => void;
  resolve: () => ResolvedWritingStyle;
}

export function realWritingStyleDeps(): WritingStyleDeps {
  return {
    home: () => process.env.HOME ?? "",
    now: () => new Date(),
    print: (s) => console.log(s),
    exit: process.exit,
    isTTY: () => process.stdin.isTTY === true,
    pick: async (message, options) => {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      return filterableSelect({ message, options, stderr: true });
    },
    prompt: async (message) => {
      const { textInput } = await import("../lib/ui/prompts.ts");
      const v = await textInput({ message, stderr: true });
      return v.trim() === "" ? null : v.trim();
    },
    pluginListStdout: async () => {
      const res = await execWithTimeout([resolveClaudeBin() ?? "claude", "plugin", "list", "--json"], { timeoutMs: 15_000 });
      return res.code === 0 ? res.stdout : null;
    },
    writeSetting: (key, value, scope) => setSetting(key, value, scope),
    resolve: () => resolveWritingStyle(),
  };
}

function refuse(err: UserActionableError, json: boolean, verb: string, deps: WritingStyleDeps): never {
  deps.print(json ? JSON.stringify(userErrorPayload(err, deps.now())) : `rt skills writing-style ${verb}: ${err.message}`);
  return deps.exit(2);
}

async function inventory(deps: WritingStyleDeps) {
  const stdout = await deps.pluginListStdout();
  return readSkillInventory(deps.home(), stdout === null ? null : parsePluginEntries(stdout));
}

export async function writingStyleShow(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const resolved = deps.resolve();
  if (args.includes("--json")) {
    deps.print(JSON.stringify(envelope({ skill: resolved.skill, source: resolved.source }, deps.now())));
    return;
  }
  deps.print(`${resolved.skill} (${WRITING_STYLE_SOURCE_LABEL[resolved.source]})`);
}

export async function writingStyleList(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const listing = listWritingStyles(await inventory(deps), deps.resolve());
  if (args.includes("--json")) {
    deps.print(JSON.stringify(envelope(listing, deps.now())));
    return;
  }
  const printRow = (o: { id: string; detail: string; installed: boolean; kind: string }) => {
    const mark = o.id === listing.current.skill ? "*" : " ";
    deps.print(`${mark} ${o.id.padEnd(40)} ${o.detail}${o.installed || o.kind === "preset" ? "" : " (not installed here)"}`);
  };
  for (const o of listing.options) printRow(o);
  const known = new Set([...listing.options, ...listing.suggestions].map((o) => o.id));
  if (!known.has(listing.current.skill)) deps.print(`* ${listing.current.skill} (current)`);
  if (listing.suggestions.length > 0) {
    deps.print("Also available (type the id):");
    for (const o of listing.suggestions) printRow(o);
  }
}

function parseUseArgs(args: string[]): { id: string | undefined; scope: string; json: boolean } {
  let scope = "user";
  let id: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") json = true;
    else if (a === "--scope") {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) { scope = next; i++; } else scope = "";
    } else if (a.startsWith("--scope=")) scope = a.slice("--scope=".length);
    else if (id === undefined) id = a;
  }
  return { id, scope, json };
}

export async function writingStyleUse(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const { id: given, scope, json } = parseUseArgs(args);
  // The app's "Use my own skill..." text reaches argv verbatim, so a leading
  // dash must be validated as an id rather than parsed as a flag.
  if (given !== undefined && !isValidSkillId(given)) return refuse(new UserActionableError("bad-id", `"${given}" is not a skill id`), json, "use", deps);
  if (scope !== "user" && scope !== "team") return refuse(new UserActionableError("usage", `--scope must be user or team, not "${scope}"`), json, "use", deps);
  // setSetting creates the store directory, and a write inside ~/.mattstack/user before home.init or home.restore clones makes that clone fail.
  if (!existsSync(homeGitDir(deps.home()))) {
    return refuse(new UserActionableError("no-home-repo", "your home repo does not exist yet; finish rt setup first"), json, "use", deps);
  }

  linkPersonalSkills(deps.home());
  const inv = await inventory(deps);
  const listing = listWritingStyles(inv, deps.resolve());

  const choosable = [...listing.options, ...listing.suggestions];
  let id = given;
  if (id === undefined) {
    if (deps.isTTY() && !json && !process.env.RT_BATCH) {
      id = (await deps.pick("Which writing style?", choosable.map((o) => ({ value: o.id, label: o.label, hint: o.detail })))) ?? undefined;
      if (!id) return deps.exit(0);
    } else {
      return refuse(new UserActionableError("usage", "usage: rt skills writing-style use <skill-id> [--scope user|team] [--json]"), json, "use", deps);
    }
  }

  if (!isValidSkillId(id)) return refuse(new UserActionableError("bad-id", `"${id}" is not a skill id`), json, "use", deps);
  if (!isStyleUsable(id, inv)) {
    const choices = choosable.filter((o) => o.kind === "preset" || o.installed).map((o) => o.id).join(", ");
    return refuse(new UserActionableError("unknown-skill", `${id} is not installed here. Choose one of: ${choices}`), json, "use", deps);
  }

  deps.writeSetting(WRITING_STYLE_KEY, id, scope);
  deps.print(json ? JSON.stringify(envelope({ skill: id, scope }, deps.now())) : `writing style: ${id} (${scope})`);
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const PRESET_SHORT = ["sparse", "conversational", "structured"] as const;

function stripCompilerComments(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("<!-- compiled by rt skills compile") && !l.trim().startsWith("<!-- part: "))
    .join("\n");
}

/** Normalizes CRLF to LF, then renames the frontmatter `name` and preset id so the copy is a skill of its own. */
function retarget(text: string, presetId: string, name: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---", 4);
  if (!normalized.startsWith("---\n") || end === -1) return null;
  const frontmatter = normalized
    .slice(0, end)
    .replace(/^name:.*$/m, `name: ${name}`)
    .split(presetId)
    .join(name);
  return frontmatter + normalized.slice(end);
}

export async function writingStyleNew(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const json = args.includes("--json");
  let from = "conversational";
  let name: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") continue;
    if (a === "--from") from = args[++i] ?? "";
    else if (a.startsWith("--from=")) from = a.slice("--from=".length);
    else if (name === undefined) name = a;
  }

  if (!existsSync(homeGitDir(deps.home()))) {
    return refuse(new UserActionableError("no-home-repo", "your home repo does not exist yet; finish rt setup first"), json, "new", deps);
  }
  if (name === undefined) {
    if (deps.isTTY() && !json && !process.env.RT_BATCH) name = (await deps.prompt("Name for your writing style (lowercase, e.g. my-voice)")) ?? undefined;
    if (name === undefined) return refuse(new UserActionableError("usage", "usage: rt skills writing-style new <name> [--from sparse|conversational|structured] [--json]"), json, "new", deps);
  }
  if (!NAME_RE.test(name)) return refuse(new UserActionableError("bad-name", `"${name}" must be lowercase letters, digits, dot, dash or underscore`), json, "new", deps);

  const presetId = (PRESET_SHORT as readonly string[]).includes(from) ? `mattstack:writing-style-${from}` : from;
  if (!presetById(presetId)) return refuse(new UserActionableError("bad-preset", `--from must be one of ${PRESET_SHORT.join(", ")}`), json, "new", deps);

  const target = join(personalSkillsDir(deps.home()), name);
  if (existsSync(target)) return refuse(new UserActionableError("exists", `${target} already exists`), json, "new", deps);

  const stdout = await deps.pluginListStdout();
  const mattstack = (stdout === null ? null : parsePluginEntries(stdout))?.find((p) => p.id.startsWith("mattstack@") && p.enabled && p.installPath);
  const source = mattstack?.installPath
    ? pluginSkillRoots(mattstack.installPath)
        .map((root) => join(root, presetId.split(":")[1]!))
        .find((candidate) => existsSync(join(candidate, "SKILL.md"))) ?? null
    : null;
  if (!source || !existsSync(join(source, "SKILL.md"))) {
    return refuse(new UserActionableError("no-plugin", "the mattstack plugin with the writing-style presets is not installed; run rt setup"), json, "new", deps);
  }

  let skillContent: string | null;
  let prDescContent: string | undefined;
  try {
    const rawSkill = readFileSync(join(source, "SKILL.md"), "utf8");
    skillContent = retarget(stripCompilerComments(rawSkill), presetId, name);
    if (existsSync(join(source, "pr-description.md"))) {
      prDescContent = stripCompilerComments(readFileSync(join(source, "pr-description.md"), "utf8"));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return refuse(new UserActionableError("no-plugin", `the installed preset ${presetId} is unreadable; reinstall the mattstack plugin (${msg})`), json, "new", deps);
  }
  if (skillContent === null) {
    return refuse(new UserActionableError("no-plugin", `the installed preset ${presetId} is unreadable; reinstall the mattstack plugin`), json, "new", deps);
  }

  let linkResult: ReturnType<typeof linkPersonalSkills> = null;
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "SKILL.md"), skillContent);
    if (prDescContent !== undefined) writeFileSync(join(target, "pr-description.md"), prDescContent);
    linkResult = linkPersonalSkills(deps.home());
  } catch (err) {
    try {
      // The exists check ran before this call, and name passed NAME_RE, so target is a directory this call just created.
      rmSync(target, { recursive: true, force: true });
    } catch {
    }
    throw err;
  }

  const conflict = linkResult?.actions.find((a) => a.name === name && a.kind === "conflict");
  if (conflict) {
    rmSync(target, { recursive: true, force: true });
    return refuse(new UserActionableError("exists", `${conflict.link} already exists`), json, "new", deps);
  }

  deps.print(json
    ? JSON.stringify(envelope({ name, path: target, from: presetId }, deps.now()))
    : `created ${target} from ${presetId}\nedit it, then: rt skills writing-style use ${name}`);
}
