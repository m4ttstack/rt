import { row, type Action, type Row } from "../contract.ts";
import type { ExecResult, Probes } from "../probes.ts";
import { homeGitDir } from "../steps/home.ts";
import { presetById, resolveWritingStyle, type ResolvedWritingStyle } from "../../skills/writing-style.ts";
import {
  isStyleUsable, listWritingStyles, parsePluginEntries, readSkillInventory, type SkillInventory, type WritingStyleOption,
} from "../../skills/writing-style-sources.ts";

export const WRITING_STYLE_ROW_ID = "skills.writing-style";

const BASE = {
  id: WRITING_STYLE_ROW_ID,
  kind: "tool" as const,
  title: "Writing style",
  why: "How the reviews, replies and PR descriptions agents post under your name read. Without one they read like an AI assistant.",
  required: false,
  finishGated: true,
  recheck: "on-change" as const,
};

const SOURCE_LABEL: Record<Exclude<ResolvedWritingStyle["source"], "fallback">, string> = {
  user: "yours",
  team: "team default",
  preferences: "from preferences.md",
};

function chooseAction(options: WritingStyleOption[], selected?: string): Action {
  return {
    type: "choose",
    label: "Choose style…",
    verb: ["skills", "writing-style", "use"],
    options: options.map(({ id, label, detail, sample }) => ({ id, label, detail, ...(sample ? { sample } : {}) })),
    ...(selected ? { selected } : {}),
    other: { label: "Use my own skill…", hint: "Any installed skill id. Start one with rt skills writing-style new." },
  };
}

export function writingStyleRow(input: { homeReady: boolean; resolved: ResolvedWritingStyle; inventory: SkillInventory; options: WritingStyleOption[] }): Row {
  const { homeReady, resolved, inventory, options } = input;
  // use writes the user store inside the home repo, which does not exist until Install clones it.
  if (!homeReady) return row({ ...BASE, status: "needs-you", detail: "You'll choose this after Install" });

  const action = chooseAction(options, resolved.source === "fallback" ? undefined : resolved.skill);
  if (resolved.source === "fallback") {
    return row({ ...BASE, status: "needs-you", detail: "Choose how your reviews and replies read (or run rt skills writing-style use)", action });
  }
  if (!isStyleUsable(resolved.skill, inventory)) {
    const plugin = inventory.disabledPluginFor.get(resolved.skill);
    return row({ ...BASE, status: "invalid", detail: plugin ? `${resolved.skill} is in a disabled plugin: enable ${plugin}` : `${resolved.skill} is not installed here`, action });
  }
  const label = presetById(resolved.skill)?.label ?? resolved.skill;
  return row({ ...BASE, status: "ready", detail: `${label} (${SOURCE_LABEL[resolved.source]})`, action });
}

/**
 * A throw here would reach buildGroup's catch and replace every tools row, so
 * the row reports its own error. The error row is not finish-gated: it cannot
 * be waived and carries no action, so gating on it would strand Finish.
 */
export function writingStyleRowFor(p: Pick<Probes, "home" | "exists">, pluginList: ExecResult): Row {
  try {
    const inventory = readSkillInventory(p.home, pluginList.code === 0 ? parsePluginEntries(pluginList.stdout) : null);
    const resolved = resolveWritingStyle({ home: p.home });
    return writingStyleRow({ homeReady: p.exists(homeGitDir(p.home)), resolved, inventory, options: listWritingStyles(inventory, resolved).options });
  } catch (err) {
    return row({ ...BASE, finishGated: false, status: "error", detail: `could not read the writing style: ${err instanceof Error ? err.message : String(err)}` });
  }
}
