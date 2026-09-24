/**
 * rt settings — Configure API keys, team defaults, and repo data.
 *
 * Subcommands (registered in cli.ts as a branch node):
 *   settings linear token   — set Linear API key
 *   settings linear team    — set default Linear team
 *   settings gitlab token   — set GitLab personal access token
 */

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve as resolvePath } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { rtDir } from "../lib/rt-paths.ts";
import { DEV_MODE_TAG, devWrapperOwnsRt, installRtBinary, rtBinaryPath } from "../lib/dev-mode.ts";
import { envelope } from "../lib/setup/contract.ts";
import { spawnSync } from "child_process";
import { bold, cyan, dim, green, red, reset, yellow } from "../lib/tui.ts";
import {
  loadSecrets,
  saveSecret,
  fetchTeams,
  saveTeamConfig,
} from "../lib/linear.ts";
import {
  loadNotificationPrefs,
  saveNotificationPrefs,
  NOTIFICATION_TYPES,
} from "../lib/notifier.ts";
import { getSetting } from "../lib/settings/resolve.ts";
import { setSetting } from "../lib/settings/write.ts";
import {
  getKvValue,
  hasKvValue,
  importLegacyJsonFile,
  setKvValue,
} from "../lib/state/index.ts";

// ─── Linear token ────────────────────────────────────────────────────────────

export async function setLinearToken(): Promise<void> {
  const { textInput } = await import("../lib/rt-render.ts");
  const secrets = await loadSecrets();

  // try scopes the prompt only — a failed *save* must surface as an error,
  // not masquerade as "keeping existing key".
  let linearKey: string;
  try {
    linearKey = await textInput({
      message: "Linear API key (lin_api_...)",
      placeholder: secrets.linearApiKey
        ? "••• (already set, leave empty to keep)"
        : "lin_api_...",
    });
  } catch {
    if (secrets.linearApiKey) {
      console.log(`  ${dim}keeping existing Linear API key${reset}`);
    }
    return;
  }

  if (!linearKey.trim()) {
    if (secrets.linearApiKey) {
      console.log(`  ${dim}keeping existing Linear API key${reset}`);
    } else {
      console.log(`  ${yellow}no key entered${reset}`);
    }
    return;
  }

  try {
    await saveSecret("linearApiKey", linearKey.trim());
  } catch (err) {
    console.log(`\n  ${red}✗ failed to save Linear API key: ${err instanceof Error ? err.message : String(err)}${reset}\n`);
    process.exit(1);
  }
  console.log(`\n  ${green}✓${reset} Linear API key saved\n`);
}

// ─── GitLab token ────────────────────────────────────────────────────────────

export async function setGitlabToken(): Promise<void> {
  const { textInput } = await import("../lib/rt-render.ts");
  const secrets = await loadSecrets();

  // try scopes the prompt only — a failed *save* must surface as an error,
  // not masquerade as "keeping existing token".
  let gitlabToken: string;
  try {
    gitlabToken = await textInput({
      message: "GitLab personal access token",
      placeholder: secrets.gitlabToken
        ? "••• (already set, leave empty to keep)"
        : "glpat-...",
    });
  } catch {
    if (secrets.gitlabToken) {
      console.log(`  ${dim}keeping existing GitLab token${reset}`);
    }
    return;
  }

  if (!gitlabToken.trim()) {
    if (secrets.gitlabToken) {
      console.log(`  ${dim}keeping existing GitLab token${reset}`);
    } else {
      console.log(`  ${yellow}no token entered${reset}`);
    }
    return;
  }

  try {
    await saveSecret("gitlabToken", gitlabToken.trim());
  } catch (err) {
    console.log(`\n  ${red}✗ failed to save GitLab token: ${err instanceof Error ? err.message : String(err)}${reset}\n`);
    process.exit(1);
  }
  console.log(`\n  ${green}✓${reset} GitLab token saved\n`);
}

// ─── StrongDM email ──────────────────────────────────────────────────────────

export async function setSdmEmail(args: string[]): Promise<void> {
  const secrets = await loadSecrets();
  const fromArgs = args.find(a => !a.startsWith("--"))?.trim();

  let email: string;
  if (fromArgs) {
    email = fromArgs;
  } else if (!process.stdin.isTTY) {
    console.log(`\n  ${red}✗ no email given and no terminal to prompt in${reset}`);
    console.log(`  ${dim}usage: rt sdm set-email <email>${reset}\n`);
    process.exitCode = 1;
    return;
  } else {
    const { textInput } = await import("../lib/rt-render.ts");
    try {
      email = await textInput({
        message: "StrongDM account email",
        placeholder: secrets.sdmEmail
          ? "••• (already set, leave empty to keep)"
          : "you@example.com",
      });
    } catch {
      if (secrets.sdmEmail) {
        console.log(`  ${dim}keeping existing StrongDM email${reset}`);
      }
      return;
    }
  }

  if (!email.trim()) {
    if (secrets.sdmEmail) {
      console.log(`  ${dim}keeping existing StrongDM email${reset}`);
    } else {
      console.log(`  ${yellow}no email entered${reset}`);
    }
    return;
  }

  try {
    await saveSecret("sdmEmail", email.trim());
  } catch (err) {
    console.log(`\n  ${red}✗ failed to save StrongDM email: ${err instanceof Error ? err.message : String(err)}${reset}\n`);
    process.exit(1);
  }
  console.log(`\n  ${green}✓${reset} StrongDM email saved\n`);
}

// ─── Linear team ─────────────────────────────────────────────────────────────

export async function setLinearTeam(): Promise<void> {
  const secrets = await loadSecrets();
  if (!secrets.linearApiKey) {
    console.log(`\n  ${yellow}Linear API key not configured${reset}`);
    console.log(`  ${dim}run: rt settings linear token${reset}\n`);
    return;
  }

  const result = await pickAndSaveTeam(secrets.linearApiKey);
  if (result) {
    console.log(`\n  ${green}✓${reset} default team set to ${bold}${result.teamKey}${reset}\n`);
  }
}

async function pickAndSaveTeam(apiKey: string): Promise<{ teamId: string; teamKey: string } | null> {
  console.log(`\n  ${dim}fetching teams…${reset}`);
  const teams = await fetchTeams(apiKey);

  if (teams.length === 0) {
    console.log(`  ${red}✗${reset} no teams found\n`);
    return null;
  }

  const { filterableSelect } = await import("../lib/pick-wrappers.ts");

  const selectedId = await filterableSelect({
    message: "Select your team",
    options: teams.map((t) => ({
      value: t.id,
      label: `${t.key}  ${t.name}`,
      hint: "",
    })),
  });

  if (!selectedId) return null;

  const team = teams.find((t) => t.id === selectedId);
  if (!team) return null;

  await saveTeamConfig(team.id, team.key);
  return { teamId: team.id, teamKey: team.key };
}

// ─── Notification preferences ────────────────────────────────────────────────

export async function configureNotifications(): Promise<void> {
  const { filterableMultiselect } = await import("../lib/pick-wrappers.ts");

  const prefs = loadNotificationPrefs();

  const options = NOTIFICATION_TYPES.map((t) => ({
    value: t.key,
    label: t.label,
    hint: t.description,
  }));

  const enabledKeys = NOTIFICATION_TYPES
    .filter((t) => prefs[t.key] !== false)
    .map((t) => t.key);

  const selected = await filterableMultiselect({
    message: "Notifications",
    options,
    initialValues: enabledKeys,
  });

  if (selected === null) {
    console.log(`\n  ${dim}cancelled — no changes${reset}\n`);
    return;
  }

  // Build new prefs: selected = enabled, unselected = disabled
  const newPrefs: Record<string, boolean> = {};
  for (const t of NOTIFICATION_TYPES) {
    newPrefs[t.key] = selected.includes(t.key);
  }

  saveNotificationPrefs(newPrefs);

  const enabledCount = selected.length;
  const totalCount = NOTIFICATION_TYPES.length;
  console.log(`\n  ${green}✓${reset} ${enabledCount}/${totalCount} notification types enabled`);

  console.log("");
}

// ─── Runaway process detection thresholds ────────────────────────────────────

export async function configureRunaway(args: string[]): Promise<void> {
  const field = args[0];
  const value = args[1];

  // A resolver throw (unexpandable ${...} variable) must not block editing
  // the setting that would fix it — degrade to {} same as loadRunawayConfig.
  let stored: Record<string, number> | undefined;
  try {
    stored = getSetting<Record<string, number> | undefined>("rt.runaway").value;
  } catch { /* degrade below */ }
  const config: Record<string, number> = stored ? { ...stored } : {};

  if (!field) {
    console.log(`\n  ${bold}Runaway process detection${reset}\n`);
    console.log(`  ${dim}cpu-threshold${reset}  ${config.cpuThreshold ?? 80}%`);
    console.log(`  ${dim}sustain-min${reset}    ${(config.sustainMs ?? 300_000) / 60_000} minutes`);
    console.log(`  ${dim}grace-min${reset}      ${(config.graceMs ?? 120_000) / 60_000} minutes`);
    console.log(`\n  ${dim}usage: rt settings runaway <field> <value>${reset}\n`);
    return;
  }

  if (!value) {
    console.log(`  ${red}missing value${reset}`);
    return;
  }

  const num = parseFloat(value);
  if (isNaN(num)) {
    console.log(`  ${red}value must be a number${reset}`);
    return;
  }

  switch (field) {
    case "cpu-threshold":
      config.cpuThreshold = num;
      break;
    case "sustain-min":
      config.sustainMs = num * 60_000;
      break;
    case "grace-min":
      config.graceMs = num * 60_000;
      break;
    default:
      console.log(`  ${red}unknown field: ${field}${reset}`);
      console.log(`  ${dim}fields: cpu-threshold, sustain-min, grace-min${reset}`);
      return;
  }

  setSetting("rt.runaway", config, "machine");
  console.log(`  ${green}✓${reset} saved`);
  console.log(`  ${dim}restart daemon to apply: rt daemon restart${reset}`);
}

// ─── Test push notification ──────────────────────────────────────────────────

export async function sendTestPushNotification(): Promise<void> {
  const { TRAY_SOCK_PATH } = await import("../lib/daemon-config.ts");

  if (!existsSync(TRAY_SOCK_PATH)) {
    console.log(`\n  ${yellow}⚠${reset}  rt tray is not running`);
    console.log(`     ${dim}(no socket at ~/.mattstack/rt/tray.sock — start the tray app first)${reset}\n`);
    return;
  }

  const event = {
    id: crypto.randomUUID(),
    title: "rt test notification",
    message: "If you see this, the tray is wired up correctly.",
    category: "test",
    timestamp: Date.now(),
  };

  try {
    const response = await fetch("http://localhost/notify", {
      unix: TRAY_SOCK_PATH,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000),
    } as any);

    if (response.ok) {
      console.log(`\n  ${green}✓${reset} Test push sent to rt tray\n`);
    } else {
      console.log(`\n  ${red}✗${reset} rt tray returned HTTP ${response.status}\n`);
    }
  } catch (e) {
    console.log(`\n  ${red}✗${reset} Failed to reach rt tray: ${(e as Error).message}\n`);
  }
}

// ─── Dev app source checkout and the ~/.local/bin/rt it runs ─────────────────

export const DEV_MODE_PRELOAD = join(rtDir(), "dev-restore-cwd.ts");

// kv row (ns='dev-mode', k='config') — see lib/state/db.ts's note on the kv
// table before touching this shape: rt-tray/Sources-daemon-shim/main.swift
// queries it directly over libsqlite3, before bun (and this module) exist.
// The shim ALSO falls back to reading devModeConfigPath() directly (read-
// only) when this row is absent — this module is the only thing that ever
// migrates/renames that legacy file, so an un-migrated machine (this row
// never written) still boots correctly until the next `enableDevMode()`
// call folds it in. See the shim's own "LEGACY FALLBACK" header comment.
const DEV_MODE_NS = "dev-mode";
const DEV_MODE_KEY = "config";

interface DevModeConfig {
  sourcePath?: string;
  bunPath?: string;
}

/** Retired storage location — kept only so a leftover pre-migration file can be imported once, then renamed out of the way. */
export function devModeConfigPath(): string {
  return join(rtDir(), "dev-mode.json");
}

function sanitizeDevModeConfig(raw: unknown): DevModeConfig {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: DevModeConfig = {};
  if (typeof r.sourcePath === "string") out.sourcePath = r.sourcePath;
  if (typeof r.bunPath === "string") out.bunPath = r.bunPath;
  return out;
}

export function readDevModeConfig(): DevModeConfig {
  if (hasKvValue(DEV_MODE_NS, DEV_MODE_KEY)) {
    return sanitizeDevModeConfig(getKvValue<unknown>(DEV_MODE_NS, DEV_MODE_KEY, {}));
  }

  const result = importLegacyJsonFile<DevModeConfig>(devModeConfigPath(), (json) => {
    const config = sanitizeDevModeConfig(json);
    setKvValue(DEV_MODE_NS, DEV_MODE_KEY, config);
    return config;
  }, { verifyPersisted: () => hasKvValue(DEV_MODE_NS, DEV_MODE_KEY) });
  return result.imported ? result.value! : {};
}

function detectSourcePath(): string | null {
  // When running from source (bun run cli.ts), import.meta.dir is the repo root
  const dir = import.meta.dir;
  if (dir && !dir.includes("/opt/homebrew") && !dir.includes("/usr/local") && !dir.startsWith("/$bunfs")) {
    // Walk up one level if we're in a subdirectory (e.g. commands/)
    const candidate = dir.endsWith("/commands") ? dir.replace(/\/commands$/, "") : dir;
    if (existsSync(`${candidate}/cli.ts`)) return candidate;
  }
  // Prefer saved config
  const saved = readDevModeConfig().sourcePath;
  if (saved && existsSync(`${saved}/cli.ts`)) return saved;

  // Fall back to common checkout locations
  const home = Bun.env.HOME!;
  for (const guess of [
    `${home}/Documents/GitHub/repo-tools`,
    `${home}/GitHub/repo-tools`,
    `${home}/code/repo-tools`,
    `${home}/src/repo-tools`,
    `${home}/repos/repo-tools`,
  ]) {
    if (existsSync(`${guess}/cli.ts`)) return guess;
  }
  return null;
}

function detectBunPath(): string {
  const which = spawnSync("command", ["-v", "bun"], { shell: true, encoding: "utf8" });
  const found = which.stdout?.trim();
  if (found && existsSync(found)) return found;
  // Fallbacks for common install locations
  for (const p of [`${Bun.env.HOME}/.bun/bin/bun`, "/opt/homebrew/bin/bun", "/usr/local/bin/bun"]) {
    if (existsSync(p)) return p;
  }
  return "bun"; // hope PATH resolves it at exec time — fine for the shell wrapper below (inherits PATH), never fine for the stored kv value (see bunPathForStorage)
}

/**
 * The Swift shim (rt-tray/Sources-daemon-shim/main.swift) never does shell
 * PATH resolution — it only ever `fileExists(atPath:)`s the exact string —
 * so a bare `"bun"` stored in the kv row would resolve against launchd's cwd
 * (`/`) and always stand down. `detectBunPath()`'s last resort ("hope PATH
 * resolves it") is a valid fallback for the shell wrapper it also feeds
 * (which does inherit PATH), but must never be persisted for the shim to
 * read: `undefined` here means "not configured", and the shim's own default
 * (`~/.bun/bin/bun`) takes over instead — strictly better than a value that
 * can never resolve.
 */
export function bunPathForStorage(detected: string): string | undefined {
  return detected.startsWith("/") ? detected : undefined;
}

/** Stores the checkout the dev wrapper and the dev daemon launcher run. */
function saveSourcePath(sourcePath: string, bunPath: string): void {
  // readDevModeConfig() first folds in (and safely imports/renames) any
  // legacy dev-mode.json — a save reached without a prior load would
  // otherwise strand an unread legacy file the moment this write makes the
  // store non-empty (the same hazard saveRegistry/saveClaims guard against).
  readDevModeConfig();
  const storedBunPath = bunPathForStorage(bunPath);
  setKvValue(DEV_MODE_NS, DEV_MODE_KEY, storedBunPath ? { sourcePath, bunPath: storedBunPath } : { sourcePath });
}

export function enableDevMode(sourcePath: string): void {
  const bunPath = detectBunPath();
  saveSourcePath(sourcePath, bunPath);

  mkdirSync(rtDir(), { recursive: true });
  mkdirSync(dirname(rtBinaryPath()), { recursive: true });

  // The absolute bun path, not bare `bun`: mattstack.app spawns rt under
  // launchd, whose PATH is only /usr/bin:/bin:/usr/sbin:/sbin.
  writeFileSync(DEV_MODE_PRELOAD, renderDevModePreload());
  writeDevModeWrapperFile(renderDevModeWrapper(sourcePath, bunPath));
}

export interface SourcePathSeams {
  log: (line: string) => void;
  error: (line: string) => void;
  exit: (code: number) => never;
}

/**
 * `rt settings source-path [<path>]`: reads or sets the rt checkout the dev
 * app runs. Setting it while the dev wrapper owns ~/.local/bin/rt rewrites
 * the wrapper too, so the CLI and the next dev daemon boot agree.
 */
export async function sourcePathCommand(
  args: string[],
  _ctx: CommandContext = {},
  seams: SourcePathSeams = { log: (l) => console.log(l), error: (l) => console.error(l), exit: (c) => process.exit(c) },
): Promise<void> {
  const json = args.includes("--json");
  const given = args.find((a) => !a.startsWith("--"));

  if (given === undefined) {
    const current = readDevModeConfig().sourcePath ?? null;
    seams.log(json ? JSON.stringify(envelope({ sourcePath: current })) : (current ?? "no source checkout set"));
    return;
  }

  const sourcePath = resolvePath(given);
  if (!existsSync(join(sourcePath, "cli.ts"))) {
    const message = `${sourcePath} is not an rt checkout (no cli.ts)`;
    if (json) seams.log(JSON.stringify(envelope({ ok: false, error: { code: "not-rt-source", message } })));
    else seams.error(`rt settings source-path: ${message}`);
    seams.exit(2);
    return;
  }

  const wrapperOwnsRt = devWrapperOwnsRt();
  if (wrapperOwnsRt) enableDevMode(sourcePath);
  else saveSourcePath(sourcePath, detectBunPath());

  if (json) seams.log(JSON.stringify(envelope({ ok: true, sourcePath, wrapperRewritten: wrapperOwnsRt })));
  else seams.log(`  source checkout: ${sourcePath}${wrapperOwnsRt ? ` (${rtBinaryPath()} rewritten)` : ""}`);
}

/**
 * The prod app may have left a SYMLINK at ~/.local/bin/rt (installRtBinary, ->
 * Contents/MacOS/rt inside the app bundle). writeFileSync opens-and-
 * truncates through a symlink, which would overwrite the bundle's real
 * binary instead of replacing the wrapper — corrupting the app's code
 * signature. Write to a sibling tmp file and rename over the destination
 * instead: rename always replaces the directory entry itself, never what it
 * points at.
 */
function writeDevModeWrapperFile(content: string): void {
  const dest = rtBinaryPath();
  const tmp = `${dest}.new`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, content, { mode: 0o755 });
  renameSync(tmp, dest);
}

// Bun transpiles with the tsconfig found in the *cwd*, so running rt from a
// repo whose tsconfig sets jsxImportSource (e.g. hono/jsx) breaks every .tsx
// file in rt with "Cannot find module '<source>/jsx-dev-runtime'". The wrapper
// used --tsconfig-override to pin rt's own tsconfig, but that flag trips a bun
// fd-bookkeeping bug that makes every rt command trail an "Internal error:
// directory mismatch" line on exit (https://github.com/oven-sh/bun/issues/22023,
// still present in 1.3.14). Instead: cd into the source repo so bun resolves
// rt's tsconfig naturally, and restore the user's launch cwd via a --preload
// script, which runs after bun fixes its transpiler config at startup but
// before any other module loads.
export function renderDevModeWrapper(sourcePath: string, bunPath: string): string {
  const bunDir = dirname(bunPath);
  return [
    `#!/bin/zsh`,
    `${DEV_MODE_TAG}`,
    // Appended, not prepended: launchd's minimal PATH only needs these dirs
    // PRESENT for logdy/lnav/bunx to resolve (bun itself execs by absolute
    // path), while a prepend would shadow the caller's own order for every
    // dev-mode invocation — pathRow's precedence read most visibly (RT-160).
    // \${PATH:+...}: an empty inherited PATH must not leave a leading empty
    // component, which zsh resolves as the current directory — and the next
    // line cds into the source checkout.
    `export PATH="\${PATH:+\$PATH:}${bunDir}:/opt/homebrew/bin:/usr/local/bin"`,
    `export RT_LAUNCH_CWD="$PWD"`,
    `export MATTSTACK_FLAVOR=dev`,
    `cd "${sourcePath}" || { echo "rt: dev-mode source checkout missing: ${sourcePath}" >&2; exit 1; }`,
    `exec "${bunPath}" run --preload="${DEV_MODE_PRELOAD}" "${sourcePath}/cli.ts" "$@"`,
  ].join("\n") + "\n";
}

export function renderDevModePreload(): string {
  return [
    `// Written by rt (commands/settings.ts) with the dev wrapper, on the dev`,
    `// app's takeover or \`rt settings source-path\`.`,
    `// The dev wrapper cds into the rt source repo before exec'ing bun; this`,
    `// puts the process back in the directory the user launched from.`,
    `const launchCwd = process.env.RT_LAUNCH_CWD;`,
    `if (launchCwd) {`,
    `  try {`,
    `    process.chdir(launchCwd);`,
    `    process.env.PWD = launchCwd;`,
    `  } catch {`,
    `    // Launch dir vanished; keep running from the source repo.`,
    `  }`,
    `  delete process.env.RT_LAUNCH_CWD;`,
    `}`,
    `export {};`,
  ].join("\n") + "\n";
}

/**
 * Points ~/.local/bin/rt at the prod app's compiled rt and drops the dev
 * wrapper's preload. `prodBinary` must exist: stranding the CLI with no rt
 * on PATH is worse than refusing.
 */
export function installProdRt(prodBinary: string): void {
  installRtBinary(prodBinary);
  if (existsSync(DEV_MODE_PRELOAD)) {
    rmSync(DEV_MODE_PRELOAD);
  }
}

/** The stored checkout when it still holds cli.ts, else the best guess (this source tree, then common locations). */
export function resolveStoredSourcePath(): string | null {
  const saved = readDevModeConfig().sourcePath;
  if (saved && existsSync(`${saved}/cli.ts`)) return saved;
  return detectSourcePath();
}
