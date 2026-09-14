/**
 * `claude.permissions` unions rt's baseline `permissions.allow` entries
 * (`base-permissions.ts`) into Claude Code's settings.json for every
 * configured Claude config dir (`claudeConfigDirs`, the same enumeration
 * `plugins.install` uses), so a freshly set up machine's agents don't stall
 * on permission prompts for the calls Install already trusts.
 *
 * File handling mirrors `linear.mcp`: absent starts from an empty object,
 * unparsable and unreadable both fail with a remedy naming the path, and
 * every other top-level key (and every other key under `permissions`)
 * survives the write untouched. It differs from `linear.mcp` in the two
 * ways `claude-permissions.ts`'s header explains: one union per config dir,
 * and the file's existing mode is preserved rather than tightened to 0600.
 */
import { join } from "path";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import { missingPermissions, readClaudeSettings, withPermissions, writeClaudeSettings } from "../claude-permissions.ts";
import type { Probes } from "../probes.ts";
import { claudeConfigDirs } from "../tools-install.ts";
import { toFailedOutcome } from "./step-utils.ts";

export interface DirPermissionsOutcome {
  path: string;
  wrote: boolean;
  failed?: { detail: string; remedy: string };
}

/** One config dir's worth of read -> union -> write, exported so multi-dir behavior is testable without an ApplyContext. */
export function applyBaselinePermissions(p: Pick<Probes, "readFile" | "exists" | "mkdirp" | "writeFile" | "rename" | "chmod" | "removeFile" | "fileMode">, dir: string): DirPermissionsOutcome {
  const path = join(dir, "settings.json");
  const read = readClaudeSettings(p, path);
  if (!read.ok && read.reason === "unparsable") {
    return { path, wrote: false, failed: { detail: `${path} is not valid JSON`, remedy: "Fix or remove that file, then Retry." } };
  }
  if (!read.ok && read.reason === "unreadable") {
    return { path, wrote: false, failed: { detail: `${path} could not be read`, remedy: "Check that file's permissions, then Retry." } };
  }
  // Only `absent` may reach the empty settings: every other reason means a
  // file is there, and the write below replaces whatever is at the path.
  const settings = read.ok ? read.settings : {};
  const toAdd = missingPermissions(settings);
  if (toAdd.length === 0) return { path, wrote: false };

  writeClaudeSettings(p, path, withPermissions(settings, toAdd));
  return { path, wrote: true };
}

async function claudePermissionsRun(ctx: ApplyContext): Promise<StepOutcome> {
  const written: string[] = [];

  for (const dir of claudeConfigDirs(ctx.p, [])) {
    const outcome = applyBaselinePermissions(ctx.p, dir);
    if (outcome.failed) return { state: "failed", detail: outcome.failed.detail, remedy: outcome.failed.remedy };
    if (outcome.wrote) written.push(outcome.path);
  }

  if (written.length === 0) return { state: "skipped", detail: "baseline permissions already present" };
  ctx.log("claude.permissions", `added baseline permissions to ${written.join(", ")}`);
  return { state: "done", detail: `added baseline permissions to ${written.length} config dir(s)` };
}

export async function installClaudePermissions(ctx: ApplyContext): Promise<StepOutcome> {
  try {
    return await claudePermissionsRun(ctx);
  } catch (err) {
    return toFailedOutcome(err);
  }
}

export const claudePermissionsStep: StepDef = {
  id: "claude.permissions",
  title: "Seed baseline Claude permissions",
  kind: "rt",
  applies: () => true,
  run: installClaudePermissions,
};
