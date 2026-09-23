#!/usr/bin/env bun

/**
 * rt code — Open a worktree in your preferred editor.
 *
 *   rt code          the current repo (picker when you're not in one)
 *   rt code --pick   force the worktree/repo picker
 *
 * The launch machinery below is shared with `rt nav`.
 *
 * Tracks a per-repo editor choice and per-directory workspace-file choice
 * (rt.workspacePrefs, machine-scoped), detects installed editors, and
 * launches one via its CLI command (code, cursor, zed, etc.), falling back
 * to the app bundle when the CLI shim is missing or broken.
 */

import { execSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getSetting } from "../lib/settings/resolve.ts";
import { setSetting } from "../lib/settings/write.ts";
import { dim, green, red, reset } from "../lib/tui.ts";
import { getRepoIdentity, getKnownRepos, findKnownRepo } from "../lib/repo.ts";
import { currentRepoIdentityFor } from "../lib/repo-arg.ts";
import { repoLabel } from "../lib/repo-label.ts";
import { pickWorktreeWithSwitch, pickFromAllRepos, isSwitchRepo } from "../lib/pickers.ts";

// ─── Preference storage (rt.workspacePrefs, machine-scoped) ────────────────

interface Prefs {
  editors: Record<string, string>;
  workspaces: Record<string, string>;
  /** Suite-wide editor id (a KNOWN_EDITORS command, e.g. "zed") or a full
      launch command. Also read by the console's open-in-editor links, so a
      loadPrefs/savePrefs cycle must round-trip it. */
  defaultEditor?: string;
}

/** A resolver throw (unexpandable ${...} variable) degrades to the same
    empty prefs a missing/corrupt file gave today. */
function loadPrefs(): Prefs {
  try {
    const raw = getSetting<Record<string, unknown> | undefined>("rt.workspacePrefs").value;
    return {
      editors: (raw?.editors as Record<string, string>) || {},
      workspaces: (raw?.workspaces as Record<string, string>) || (raw?.entries as Record<string, string>) || {},
      defaultEditor: raw?.defaultEditor as string | undefined,
    };
  } catch {
    return { editors: {}, workspaces: {} };
  }
}

/** A store typo (e.g. a duplicate key anywhere in the machine document) must
    never brick editor launch — degrade to a warning, same as loadPrefs. */
function savePrefs(prefs: Prefs): void {
  try {
    setSetting("rt.workspacePrefs", prefs, "machine");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("rt: could not save workspace prefs — " + message);
  }
}

export const __test__ = { loadPrefs, savePrefs, savedEditor };

// ─── Editor detection ────────────────────────────────────────────────────────

interface EditorOption {
  command: string;
  label: string;
}

const KNOWN_EDITORS: EditorOption[] = [
  { command: "code", label: "VS Code" },
  { command: "cursor", label: "Cursor" },
  { command: "zed", label: "Zed" },
  { command: "codium", label: "VSCodium" },
  { command: "windsurf", label: "Windsurf" },
  { command: "subl", label: "Sublime Text" },
  { command: "atom", label: "Atom" },
  { command: "idea", label: "IntelliJ IDEA" },
  { command: "webstorm", label: "WebStorm" },
];

// App bundle fallbacks for when the CLI isn't in PATH (macOS only).
// command is passed directly to execSync, e.g. `open -a "Cursor" "<target>"`.
const KNOWN_APPS: EditorOption[] = [
  { command: 'open -a "Cursor"', label: "Cursor" },
  { command: 'open -a "Visual Studio Code"', label: "VS Code" },
  { command: 'open -a "Zed"', label: "Zed" },
  { command: 'open -a "Antigravity"', label: "Antigravity" },
  { command: 'open -a "Windsurf"', label: "Windsurf" },
  { command: 'open -a "Sublime Text"', label: "Sublime Text" },
  { command: 'open -a "WebStorm"', label: "WebStorm" },
];

function detectInstalledEditors(): EditorOption[] {
  const { existsSync } = require("fs");
  const { homedir } = require("os");
  const home = homedir();

  const cliEditors = KNOWN_EDITORS.filter((e) => {
    try {
      execSync(`which ${e.command}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  });
  if (cliEditors.length > 0) return cliEditors;

  // Fall back to app bundle detection (macOS)
  return KNOWN_APPS.filter((e) => {
    const appName = e.command.match(/"(.+)"/)?.[1];
    if (!appName) return false;
    return (
      existsSync(`/Applications/${appName}.app`) ||
      existsSync(`${home}/Applications/${appName}.app`)
    );
  });
}

// ─── Sync resolvers (no prompts) ────────────────────────────────────────────
// The single source of truth for "can we resolve without a picker?"

/**
 * Validates that a saved/known editor command can actually be launched.
 * Two forms exist:
 *   - app-bundle commands like `open -a "Antigravity"` → check the .app exists
 *   - CLI commands like `code` / `cursor` → `which` the binary
 * `which`-ing a full `open -a "App"` string fails (which tries to resolve the
 * args as commands too), which silently dropped saved app-bundle prefs.
 */
function isEditorCommandAvailable(command: string): boolean {
  const appMatch = command.match(/^open\s+-a\s+"(.+)"\s*$/);
  if (appMatch) {
    const appName = appMatch[1]!;
    const home = homedir();
    return existsSync(`/Applications/${appName}.app`)
      || existsSync(`${home}/Applications/${appName}.app`);
  }
  const binary = command.trim().split(/\s+/)[0]!;
  try { execSync(`which ${binary}`, { stdio: "pipe" }); return true; } catch { return false; }
}

/**
 * The editor pref key for a directory. Both entry points MUST derive it the
 * same way or a choice saved through `rt code` is invisible to `rt nav` and
 * the two drift to different editors for one repo. The repo identity is that
 * shared key: stable across worktrees, renames, and whichever subdirectory
 * nav happened to be sitting in. Anything outside a repo keys on its own
 * basename, as before.
 */
export function editorPrefKey(dirPath: string): string {
  return currentRepoIdentityFor(dirPath) ?? dirPath.split("/").pop() ?? "unknown";
}

/**
 * A pref saved before the identity cutover is adopted, not re-prompted for:
 * `rt nav` keyed on a directory basename and older `rt code` builds on a
 * display name.
 */
function savedEditor(prefs: Prefs, repoKey: string, legacyKeys: string[]): string | undefined {
  return prefs.editors[repoKey] ?? legacyKeys.map(k => prefs.editors[k]).find(Boolean);
}

/**
 * Resolves prefs.defaultEditor to a launchable command: the value itself
 * when it already launches (a CLI on PATH or a full `open -a` command),
 * otherwise the app-bundle form of the same editor (an id like "zed" is
 * stored even where only Zed.app exists, no CLI shim).
 */
export function resolveDefaultEditor(prefs: Prefs): string | undefined {
  const id = prefs.defaultEditor;
  if (!id) return undefined;
  if (isEditorCommandAvailable(id)) return id;
  const label = KNOWN_EDITORS.find(e => e.command === id)?.label;
  const app = label && KNOWN_APPS.find(a => a.label === label);
  if (app && isEditorCommandAvailable(app.command)) return app.command;
  return undefined;
}

/**
 * Returns the editor command if it can be determined without an interactive
 * picker (saved pref, the suite-wide default, or exactly one editor
 * installed). Returns null if a picker is required.
 */
export function resolveEditorSync(prefs: Prefs, repoKey: string, legacyKeys: string[] = []): string | null {
  const saved = savedEditor(prefs, repoKey, legacyKeys);
  if (saved && isEditorCommandAvailable(saved)) return saved;
  const fallback = resolveDefaultEditor(prefs);
  if (fallback) return fallback;
  const installed = detectInstalledEditors();
  if (installed.length === 1) return installed[0]!.command;
  return null; // 0 = will error, 2+ = picker needed
}

/**
 * Returns the workspace target path if it can be determined without an
 * interactive picker (saved pref, zero files, or exactly one file).
 * Returns null if a picker is required (multiple .code-workspace files).
 */
export function resolveWorkspaceSync(dirPath: string, prefs: Prefs): string | null {
  const saved = prefs.workspaces[dirPath];
  if (saved) {
    const candidate = join(dirPath, saved);
    if (existsSync(candidate)) return candidate;
  }
  try {
    const wsFiles = readdirSync(dirPath).filter(f => f.endsWith(".code-workspace")).sort();
    if (wsFiles.length === 0) return dirPath;
    if (wsFiles.length === 1) return join(dirPath, wsFiles[0]!); // auto-save on first use
    return null; // multiple files — picker required
  } catch {
    return dirPath;
  }
}

// ─── Async resolvers (with pickers) ─────────────────────────────────────────

async function ensureEditor(prefs: Prefs, repoKey: string, legacyKeys: string[] = []): Promise<string> {
  // Fast path: sync resolver covers the common case
  const fast = resolveEditorSync(prefs, repoKey, legacyKeys);
  if (fast) {
    // Auto-save if it was detected, or adopted off a legacy key. A
    // defaultEditor resolution is NOT pinned per-repo: changing the default
    // later must flow through to repos that never made an explicit choice.
    if (!prefs.editors[repoKey] && fast !== resolveDefaultEditor(prefs)) {
      prefs.editors[repoKey] = fast;
      savePrefs(prefs);
    }
    return fast;
  }

  const installed = detectInstalledEditors();
  if (installed.length === 0) {
    console.log(`\n  ${red}No supported editor CLI found.${reset}`);
    console.log(`  ${dim}Install one of: code, cursor, zed, codium, subl${reset}\n`);
    process.exit(1);
  }

  const { select } = await import("../lib/rt-render.ts");
  const selected = await select({
    message: `Which editor for ${repoLabel(repoKey)}?`,
    options: installed.map(e => ({
      value: e.command,
      label: e.label,
      hint: e.command,
    })),
  });

  prefs.editors[repoKey] = selected;
  savePrefs(prefs);
  return selected;
}

async function resolveWorkspaceTarget(dirPath: string, prefs: Prefs): Promise<string> {
  // Fast path: sync resolver covers the common case
  const fast = resolveWorkspaceSync(dirPath, prefs);
  if (fast) {
    // Auto-save single workspace file if not yet persisted
    const wsFile = fast !== dirPath ? fast.split("/").pop()! : null;
    if (wsFile && !prefs.workspaces[dirPath]) {
      prefs.workspaces[dirPath] = wsFile;
      savePrefs(prefs);
    }
    return fast;
  }

  // Multiple workspace files — show picker
  const wsFiles = readdirSync(dirPath).filter(f => f.endsWith(".code-workspace")).sort();
  const { select } = await import("../lib/rt-render.ts");
  const options = [
    ...wsFiles.map(f => ({ value: f, label: f, hint: "workspace file" })),
    { value: "__folder__", label: "Open folder without workspace file", hint: "" },
  ];

  const selected = await select({
    message: "Multiple workspace files found",
    options,
  });

  if (selected !== "__folder__") {
    prefs.workspaces[dirPath] = selected;
    savePrefs(prefs);
    return join(dirPath, selected);
  }

  return dirPath;
}

// ─── Editor launch (with app-bundle fallback) ───────────────────────────────

function editorLabelFor(command: string): string {
  return KNOWN_EDITORS.find(e => e.command === command)?.label
    || KNOWN_APPS.find(a => a.command === command)?.label
    || command;
}

/**
 * If a bare-CLI editor command (e.g. `cursor`) is missing or broken but the
 * matching IDE is installed as an app bundle, returns the `open -a "App"`
 * command to launch it. Returns null when no app-bundle fallback applies
 * (already an app-bundle launch, unknown editor, or app not installed).
 *
 * This is what keeps editor launches landing on an actual IDE even when the
 * `cursor` on PATH is the cursor-agent shim, which is a dead end.
 */
export function appBundleFallback(editorCommand: string): string | null {
  if (/^open\s+-a\s+/.test(editorCommand)) return null; // already an app launch
  const binary = editorCommand.trim().split(/\s+/)[0]!;
  const label = KNOWN_EDITORS.find(e => e.command === binary)?.label;
  if (!label) return null;
  const app = KNOWN_APPS.find(a => a.label === label);
  const appName = app?.command.match(/"(.+)"/)?.[1];
  if (!appName) return null;
  const home = homedir();
  const exists = existsSync(`/Applications/${appName}.app`)
    || existsSync(`${home}/Applications/${appName}.app`);
  return exists ? app!.command : null;
}

/**
 * Launches `target` in `editor`. If a bare-CLI editor fails but its IDE is
 * installed as an app, retries via the app bundle. Returns the command that
 * actually opened the editor, or null if every attempt failed.
 */
function launchEditor(editor: string, target: string): string | null {
  try {
    execSync(`${editor} "${target}"`, { stdio: "inherit" });
    return editor;
  } catch {
    const fallback = appBundleFallback(editor);
    if (!fallback) return null;
    try {
      execSync(`${fallback} "${target}"`, { stdio: "inherit" });
      return fallback;
    } catch {
      return null;
    }
  }
}

export interface ResolvedEditor {
  command: string;
  label: string;
}

export function resolveEditorForDir(dir: string): ResolvedEditor | null {
  const prefs = loadPrefs();
  const basename = dir.split("/").pop() || "unknown";
  const command = resolveEditorSync(prefs, editorPrefKey(dir), [basename]);
  return command ? { command, label: editorLabelFor(command) } : null;
}

// glitter owns the terminal, so the launch must neither inherit stdio nor
// block the driver the way launchEditor's execSync does. The target goes in
// as "$1", never spliced into the command string.
async function spawnEditor(command: string, target: string): Promise<boolean> {
  const proc = Bun.spawn(["/bin/sh", "-c", `${command} "$1"`, "sh", target], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

export async function launchEditorDetached(
  command: string,
  target: string,
  fallback: (command: string) => string | null = appBundleFallback,
): Promise<boolean> {
  if (await spawnEditor(command, target)) return true;
  const alternate = fallback(command);
  return alternate ? spawnEditor(alternate, target) : false;
}

// ─── Shared opener (used by rt nav) ─────────────────────────────────────────

export async function openDirectoryInEditor(dirPath: string): Promise<void> {
  const prefs = loadPrefs();
  const basename = dirPath.split("/").pop() || "unknown";
  const repoKey = editorPrefKey(dirPath);
  const editor = await ensureEditor(prefs, repoKey, [basename]);
  const editorLabel = editorLabelFor(editor);
  const target = await resolveWorkspaceTarget(dirPath, prefs);

  const used = launchEditor(editor, target);
  if (used) {
    if (used !== editor) { prefs.editors[repoKey] = used; savePrefs(prefs); }
    console.error(`\n  ${green}✓${reset} Opened ${dirPath.split("/").pop()} in ${editorLabel}`);
  } else {
    console.error(`\n  ${red}Failed to open ${editorLabel}. Is '${editor}' CLI installed?${reset}`);
    process.exit(1);
  }
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export async function openInEditor(args: string[]): Promise<void> {
  const pickMode = args.includes("-p") || args.includes("--pick");

  // getRepoIdentity() registers the current repo via updateRepoIndex as a side
  // effect, so it MUST run before getKnownRepos() — otherwise a repo entered
  // for the first time is absent from `repos` and falls through to the global
  // picker instead of being recognized as where you already are.
  const identity = getRepoIdentity();
  const repos = getKnownRepos();
  const currentRepo = identity
    ? findKnownRepo(repos, identity) ?? null
    : null;

  let selectedPath: string;

  if (!pickMode && currentRepo) {
    selectedPath = identity!.repoRoot;
  } else if (pickMode && currentRepo && currentRepo.worktrees.length > 1) {
    const result = await pickWorktreeWithSwitch(currentRepo, identity!.repoRoot);
    selectedPath = isSwitchRepo(result)
      ? await pickFromAllRepos(repos)
      : result;
  } else {
    selectedPath = await pickFromAllRepos(repos);
  }

  const selectedRepo = repos.find(r => r.worktrees.some(wt => wt.path === selectedPath));
  const basename = selectedPath.split("/").pop() || "unknown";
  const repoKey = editorPrefKey(selectedPath);

  const prefs = loadPrefs();
  // The index row's own key is a legacy candidate: an unregistered scanned row
  // is keyed by basename, and pre-cutover rows by display name.
  const editor = await ensureEditor(prefs, repoKey, [selectedRepo?.repoName, basename].filter((k): k is string => !!k));
  const editorLabel = editorLabelFor(editor);
  const target = await resolveWorkspaceTarget(selectedPath, prefs);

  const used = launchEditor(editor, target);
  if (used) {
    if (used !== editor) { prefs.editors[repoKey] = used; savePrefs(prefs); }
    const label = target.endsWith(".code-workspace")
      ? target.split("/").pop()
      : selectedPath.split("/").pop();
    console.log(`\n  ${green}✓${reset} Opened ${label} in ${editorLabel}`);
  } else {
    console.log(`\n  ${red}Failed to open ${editorLabel}. Is '${editor}' CLI installed?${reset}`);
    console.log(`  ${dim}Reset your editor preference with: rt settings set rt.workspacePrefs '{}' --scope machine${reset}\n`);
    process.exit(1);
  }
}
