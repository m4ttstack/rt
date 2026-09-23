/**
 * rt skills writing-style -- show, list, choose, or start the voice for
 * prose posted under your name (MR descriptions, commit messages, replies).
 */

import { resolveClaudeBin } from "../lib/claude-bin.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, userErrorPayload } from "../lib/setup/errors.ts";
import { execWithTimeout } from "../lib/setup/probes.ts";
import { setSetting } from "../lib/settings/write.ts";
import { resolveWritingStyle, type ResolvedWritingStyle } from "../lib/skills/writing-style.ts";
import { listWritingStyles, parsePluginEntries, readSkillInventory } from "../lib/skills/writing-style-sources.ts";
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
