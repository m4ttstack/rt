/**
 * rt skills writing-style -- show, list, choose, or start the voice for
 * prose posted under your name (MR descriptions, commit messages, replies).
 */

import { existsSync } from "fs";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import { homeGitDir } from "../lib/setup/steps/home.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, userErrorPayload } from "../lib/setup/errors.ts";
import { execWithTimeout } from "../lib/setup/probes.ts";
import { setSetting } from "../lib/settings/write.ts";
import { isValidSkillId, resolveWritingStyle, WRITING_STYLE_KEY, type ResolvedWritingStyle } from "../lib/skills/writing-style.ts";
import { isStyleUsable, linkPersonalSkills, listWritingStyles, parsePluginEntries, readSkillInventory } from "../lib/skills/writing-style-sources.ts";
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

const SOURCE_LABEL: Record<ResolvedWritingStyle["source"], string> = {
  user: "yours",
  team: "team default",
  preferences: "from preferences.md",
  fallback: "not chosen; conversational fallback",
};

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
  deps.print(`${resolved.skill} (${SOURCE_LABEL[resolved.source]})`);
}

export async function writingStyleList(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const listing = listWritingStyles(await inventory(deps), deps.resolve());
  if (args.includes("--json")) {
    deps.print(JSON.stringify(envelope(listing, deps.now())));
    return;
  }
  for (const o of listing.options) {
    const mark = o.id === listing.current.skill ? "*" : " ";
    deps.print(`${mark} ${o.id.padEnd(40)} ${o.detail}${o.installed || o.kind === "preset" ? "" : " (not installed here)"}`);
  }
}

function parseUseArgs(args: string[]): { id: string | undefined; scope: string; json: boolean } {
  let scope = "user";
  let id: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") json = true;
    else if (a === "--scope") scope = args[++i] ?? "";
    else if (a.startsWith("--scope=")) scope = a.slice("--scope=".length);
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

  let id = given;
  if (id === undefined) {
    if (deps.isTTY() && !json && !process.env.RT_BATCH) {
      id = (await deps.pick("Which writing style?", listing.options.map((o) => ({ value: o.id, label: o.label, hint: o.detail })))) ?? undefined;
      if (!id) return deps.exit(0);
    } else {
      return refuse(new UserActionableError("usage", "usage: rt skills writing-style use <skill-id> [--scope user|team] [--json]"), json, "use", deps);
    }
  }

  if (!isValidSkillId(id)) return refuse(new UserActionableError("bad-id", `"${id}" is not a skill id`), json, "use", deps);
  if (!isStyleUsable(id, inv)) {
    const choices = listing.options.filter((o) => o.kind === "preset" || o.installed).map((o) => o.id).join(", ");
    return refuse(new UserActionableError("unknown-skill", `${id} is not installed here. Choose one of: ${choices}`), json, "use", deps);
  }

  deps.writeSetting(WRITING_STYLE_KEY, id, scope);
  deps.print(json ? JSON.stringify(envelope({ skill: id, scope }, deps.now())) : `writing style: ${id} (${scope})`);
}
