/**
 * rt flavor takeover <dev|prod> -- what an app does when it is opened by
 * hand: the other app's tray gives up its registrations and quits, its
 * launchd jobs are booted out, a hand-installed deck agent is retired, and
 * ~/.local/bin/rt is pointed at the target (the source wrapper for dev, the
 * bundled compiled rt for prod). It never opens anything: the caller is the
 * target app itself, already running.
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { buildFlavor, daemonLabelFor, deckLabelFor, otherFlavor, type Flavor } from "../lib/flavor.ts";
import { bundleRootFromExec, RT_BUNDLE_PATH } from "../lib/bundle-layout.ts";
import { rtBinaryPath } from "../lib/dev-mode.ts";
import { DEV_TRAY_APP_NAME, TRAY_APP_BUNDLE, TRAY_APP_NAME, trayAppPath } from "../lib/rt-paths.ts";
import { envelope } from "../lib/setup/contract.ts";
import { installShellIntegration } from "../lib/shell-integration.ts";
import { enableDevMode, installProdRt, resolveStoredSourcePath } from "./settings.ts";

export interface TakeoverSeams {
  exists: (path: string) => boolean;
  /** The rt checkout the dev wrapper runs, or null when none is known. */
  resolveSourcePath: () => string | null;
  /** The prod app bundle this compiled rt runs from, or null from source. */
  ownProdBundle: () => string | null;
  log: (line: string) => void;
  error: (line: string) => void;
  exit: (code: number) => never;
}

function realSeams(): TakeoverSeams {
  return {
    exists: existsSync,
    resolveSourcePath: resolveStoredSourcePath,
    ownProdBundle: () => (buildFlavor() === "prod" ? bundleRootFromExec() : null),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    exit: (code) => process.exit(code),
  };
}

function appName(flavor: Flavor): string {
  return flavor === "dev" ? DEV_TRAY_APP_NAME : TRAY_APP_NAME;
}

const GONE_POLL_TIMEOUT_MS = 3_000;
const GONE_POLL_INTERVAL_MS = 75;

/** The tray on the shared socket and the flavor its /health names; a leaked socket file answers nothing. */
async function trayHolder(sockPath: string): Promise<{ flavor: Flavor | null } | null> {
  if (!existsSync(sockPath)) return null;
  try {
    const res = await fetch("http://localhost/health", { unix: sockPath, signal: AbortSignal.timeout(500) } as RequestInit);
    const body = (await res.json().catch(() => ({}))) as { flavor?: unknown };
    return { flavor: body.flavor === "dev" || body.flavor === "prod" ? body.flavor : null };
  } catch {
    return null;
  }
}

// env forwarded explicitly: Bun resolves a bare command against the
// process-start PATH unless one is passed.
function launchctl(args: string[]): { status: number; out: string } {
  const r = spawnSync("launchctl", args, { encoding: "utf8", stdio: "pipe", env: process.env });
  return { status: r.error ? -1 : (r.status ?? -1), out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function isLoaded(label: string): boolean {
  const r = launchctl(["list", label]);
  return r.status === 0 && !r.out.includes("Could not find");
}

function bootout(label: string): void {
  launchctl(["bootout", `gui/${process.getuid?.() ?? 501}/${label}`]);
}

async function waitUntilGone(sockPath: string, label: string): Promise<boolean> {
  const deadline = Date.now() + GONE_POLL_TIMEOUT_MS;
  for (;;) {
    if ((await trayHolder(sockPath)) === null && !isLoaded(label)) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(GONE_POLL_INTERVAL_MS);
  }
}

function fail(seams: TakeoverSeams, json: boolean, code: string, message: string): void {
  if (json) seams.log(JSON.stringify(envelope({ ok: false, error: { code, message } })));
  else seams.error(`rt flavor takeover: ${message}`);
  seams.exit(2);
}

export async function flavorTakeover(args: string[], _ctx: CommandContext = {}, overrides: Partial<TakeoverSeams> = {}): Promise<void> {
  const seams = { ...realSeams(), ...overrides };
  const json = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--"));
  if (target !== "dev" && target !== "prod") {
    fail(seams, json, "usage", "usage: rt flavor takeover <dev|prod>");
    return;
  }
  const other = otherFlavor(target);

  let sourcePath: string | null = null;
  let prodBinary: string | null = null;
  if (target === "dev") {
    sourcePath = seams.resolveSourcePath();
    if (!sourcePath) {
      fail(seams, json, "no-source-path", "no rt source checkout is known; set one with: rt settings source-path <path>");
      return;
    }
  } else {
    prodBinary = join(seams.ownProdBundle() ?? trayAppPath(seams.exists), RT_BUNDLE_PATH);
    if (!seams.exists(prodBinary)) {
      fail(seams, json, "no-prod-app", `${TRAY_APP_BUNDLE} is not installed, so there is no compiled rt to link at ${rtBinaryPath()}`);
      return;
    }
  }

  const lines: string[] = [];
  const { TRAY_SOCK_PATH } = await import("../lib/daemon-config.ts");
  const { trayQuery } = await import("../lib/daemon-client.ts");
  const otherDaemon = daemonLabelFor(other);

  let retired: boolean | null = null;
  const holder = await trayHolder(TRAY_SOCK_PATH);
  if (holder?.flavor === other) {
    const reply = await trayQuery("/flavor/retire", "POST");
    retired = reply?.ok === true;
    lines.push(retired
      ? `${appName(other)} retired its daemon and login item`
      : `${appName(other)} did not retire (${(reply as { error?: string } | null)?.error ?? "no reply"}); booting ${otherDaemon} out directly`);
    if (!retired) bootout(otherDaemon);
    spawnSync("osascript", ["-e", `tell application "${appName(other)}" to quit`], { stdio: "pipe", timeout: 3_000, env: process.env });
  }
  // The retired tray keeps its listener until it exits, and with its window
  // on screen it turns an AppleScript quit into a window close; pkill is the
  // quit that always lands.
  spawnSync("pkill", ["-x", appName(other)], { stdio: "pipe", env: process.env });
  if (holder?.flavor === other) {
    const gone = await waitUntilGone(TRAY_SOCK_PATH, otherDaemon);
    lines.push(gone ? `${appName(other)} quit` : `${appName(other)} did not fully quit in time`);
  }

  const { describeHandDeckRetire, realHandDeckAgentSeams, retireHandInstalledDeckAgent } = await import("../lib/deck-hand-agent.ts");
  const handDeck = retireHandInstalledDeckAgent(realHandDeckAgentSeams());
  const handDeckLine = describeHandDeckRetire(handDeck);
  if (handDeckLine) lines.push(handDeckLine);

  const bootedOut: string[] = [];
  for (const label of [otherDaemon, deckLabelFor(other)]) {
    if (!isLoaded(label)) continue;
    bootout(label);
    bootedOut.push(label);
  }
  if (bootedOut.length > 0) lines.push(`booted out ${bootedOut.join(", ")}`);

  if (target === "dev") {
    enableDevMode(sourcePath!);
    installShellIntegration();
    lines.push(`${rtBinaryPath()} runs the source at ${sourcePath}`);
  } else {
    installProdRt(prodBinary!);
    lines.push(`${rtBinaryPath()} links ${prodBinary}`);
  }

  if (json) {
    seams.log(JSON.stringify(envelope({
      ok: true,
      flavor: target,
      retired,
      bootedOut,
      handDeck: handDeck.kind,
      rt: rtBinaryPath(),
    })));
    return;
  }
  for (const line of lines) seams.log(`  ${line}`);
  seams.log(`  this Mac now runs the ${target} app`);
}
