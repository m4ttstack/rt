/**
 * lib/agent-hooks.ts ... the AskUserQuestion PreToolUse hook every `rt agent`
 * launch injects (docs/superpowers/specs/2026-09-11-executor-reconciler-design.md
 * "AskUserQuestion hook").
 *
 * gate-fork.sh path resolution mirrors lib/ui/resolve.ts's resolveRtUi:
 * source checkout wins over an installed bundle (dev mode's blessed bundle is
 * never rebuilt, so bundle-first would pin every source run to a stale
 * copy). Unlike rt-ui there is no PATH fallback: the hook's `command` field
 * must be an absolute path per the Claude Code hook contract, and
 * gate-fork.sh is never installed onto PATH.
 *
 * NOTE for the bundle build: build.sh does not yet embed scripts/hooks/
 * gate-fork.sh under Contents/Helpers, so the bundle branch below is
 * currently always a miss on an installed app. Wiring that copy step is
 * tracked as follow-up, not part of this module.
 */
import { existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { appBundleRoot, bundleRootFromExec, HELPERS_DIR } from "./bundle-layout.ts";

export interface GateForkHookProbes {
  exists(p: string): boolean;
  bundleRoot(): string | null;
  sourceRoot(): string | null;
}

function defaultSourceRoot(): string | null {
  // import.meta.dir is a real directory only when running from source; a
  // compiled binary reports a virtual path that does not exist on disk.
  const here = import.meta.dir;
  if (!here || bundleRootFromExec() !== null) return null;
  try {
    if (!statSync(here).isDirectory()) return null;
  } catch {
    return null;
  }
  return resolve(here, "..");
}

export const defaultGateForkHookProbes: GateForkHookProbes = {
  exists: existsSync,
  bundleRoot: () => appBundleRoot(),
  sourceRoot: defaultSourceRoot,
};

/**
 * Absolute path to scripts/hooks/gate-fork.sh, or null when neither a source
 * checkout nor an installed bundle carries it. Callers treat null as "skip
 * hook injection" (lib/daemon/handlers/agent.ts), never as fatal -- a
 * machine mid-way through a bundle change must still be able to launch
 * agents.
 */
export function resolveGateForkHookPath(p: GateForkHookProbes = defaultGateForkHookProbes): string | null {
  const src = p.sourceRoot();
  if (src) {
    const candidate = join(src, "scripts", "hooks", "gate-fork.sh");
    if (p.exists(candidate)) return candidate;
  }
  const bundle = p.bundleRoot();
  if (bundle) {
    const candidate = join(bundle, HELPERS_DIR, "gate-fork.sh");
    if (p.exists(candidate)) return candidate;
  }
  return null;
}

export interface GateForkHookEntry {
  matcher: "AskUserQuestion";
  hooks: [{ type: "command"; command: string }];
}

export interface GateForkHookSettings {
  hooks: { PreToolUse: [GateForkHookEntry] };
}

function gateForkHookEntry(hookPath: string): GateForkHookEntry {
  return { matcher: "AskUserQuestion", hooks: [{ type: "command", command: hookPath }] };
}

/** The exact PreToolUse settings block Task 9's hook contract requires, gated on the resolved absolute path to gate-fork.sh. */
export function gateForkHookSettings(hookPath: string): GateForkHookSettings {
  return { hooks: { PreToolUse: [gateForkHookEntry(hookPath)] } };
}

/**
 * A launch never emits two `--settings` flags (repeated-flag semantics are
 * unverified against the real CLI, and a silent last-wins would drop
 * whichever settings lost), so a launch that already carries its own inline
 * settings object (today, only lib/agent-argv.ts's
 * CROSS_SESSION_INBOUND_SETTINGS) must fold the hook into that SAME object
 * instead of writing a second file. Additive only: every key of `base`
 * survives untouched, and the hook's PreToolUse entry is appended to
 * `base`'s own hooks.PreToolUse array (concatenated, never displacing it) --
 * the hook block wins nothing. `base` undefined (no inline settings on this
 * launch) reduces to the plain gateForkHookSettings shape above.
 */
export function mergeGateForkHookSettings(
  base: Record<string, unknown> | undefined,
  hookPath: string,
): Record<string, unknown> {
  if (!base) return { hooks: gateForkHookSettings(hookPath).hooks };
  const baseHooks = (base.hooks && typeof base.hooks === "object") ? base.hooks as Record<string, unknown> : {};
  const basePreToolUse = Array.isArray(baseHooks.PreToolUse) ? baseHooks.PreToolUse : [];
  return {
    ...base,
    hooks: { ...baseHooks, PreToolUse: [...basePreToolUse, gateForkHookEntry(hookPath)] },
  };
}
