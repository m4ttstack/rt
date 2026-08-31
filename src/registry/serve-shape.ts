import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { bundleHelpersDir } from "../services/bundle-layout.ts";
import { composeServicePath, resolveProgram } from "../services/exec-env.ts";
import { readDeckManifest, startArgv, type DeckManifest } from "./deck-manifest.ts";
import { addIssue, clearIssues, type AppRecord } from "./records.ts";
import { isDevMode } from "../api/dev-mode.ts";

export interface ResolvedShape { command: string[]; cwd: string; }

/** Prod data dir convention for managed apps: derived from the name, never stored. */
export function dataDir(name: string): string {
  return join(process.env.HOME ?? homedir(), ".mattstack", name);
}

/** The installed bundle binary for a managed app, or null when deck runs outside
    a bundle or the binary is not installed. Existence is checked here so no
    caller can ever build a phantom bundle command. */
export function bundleBinaryPath(name: string, helpersDir: string | null = bundleHelpersDir()): string | null {
  if (!helpersDir) return null;
  const bin = join(helpersDir, name);
  return existsSync(bin) ? bin : null;
}

export type LinkedManifest =
  | { state: "unlinked" }
  | { state: "broken"; error: string }
  | { state: "linked"; manifest: DeckManifest; dir: string };

/** The one dir + manifest validity check, shared by the resolver and the
    command-route gate so the two cannot diverge. */
export function readLinkedManifest(record: AppRecord): LinkedManifest {
  const dir = record.dev?.workingDirectory;
  if (!dir) return { state: "unlinked" };
  if (!existsSync(dir)) return { state: "broken", error: `${dir} does not exist` };
  const parsed = readDeckManifest(dir);
  if (parsed === null) return { state: "broken", error: `no mattstack.deck.json in ${dir}` };
  if (!parsed.ok) return { state: "broken", error: parsed.error };
  return { state: "linked", manifest: parsed.manifest, dir };
}

/** Command keys the board may show for a record, mirroring the command route's gate. */
export function commandKeysFor(record: AppRecord, devMode: boolean): string[] | undefined {
  if (record.managedBy === "user") {
    const keys = Object.keys(record.commands ?? {});
    return keys.length ? keys : undefined;
  }
  if (!record.dev?.workingDirectory && record.commands) {
    return devMode ? Object.keys(record.commands) : undefined;
  }
  if (!devMode || !record.dev?.workingDirectory) return undefined;
  const link = readLinkedManifest(record);
  if (link.state !== "linked") return undefined;
  const keys = Object.keys(link.manifest.dev ?? {}).filter((k) => k !== "start");
  return keys.length ? keys : undefined;
}

export interface ServeShapeDeps {
  devMode?: () => boolean;
  /** Test seam for bundleBinaryPath's helpers dir; default derives from the running bundle. */
  helpersDir?: string | null;
}

export function sourceShape(record: AppRecord): ResolvedShape | null {
  const link = readLinkedManifest(record);
  if (link.state !== "linked") return null;
  const start = link.manifest.dev?.start;
  if (!start) return null;
  return { command: startArgv(start), cwd: link.dir };
}

/** launchd never searches PATH for argv0, but a stored command predates that
    rule for legacy rows, so a bare name here still has to resolve the same
    way specFor's render-time lookup would, or a legacy relative argv0 always
    reads as a phantom bundle. */
function storedCommandExists(argv0: string): boolean {
  return argv0.includes("/") ? existsSync(argv0) : resolveProgram(argv0, composeServicePath()) !== null;
}

export function bundleShape(record: AppRecord, helpersDir?: string | null): ResolvedShape | null {
  // A stored command on a dev-linked row is the prod shape rt setup registered
  // (absolute bundled binary, possibly with serve args); it outranks derivation
  // so args like gitq's `board` are never lost. Existence-checked like the
  // derived path: never a phantom bundle.
  if (record.command?.length) {
    return storedCommandExists(record.command[0]!)
      ? { command: record.command, cwd: record.workingDirectory ?? dataDir(record.name) }
      : null;
  }
  const bin = bundleBinaryPath(record.name, helpersDir);
  return bin ? { command: [bin], cwd: dataDir(record.name) } : null;
}

function issue(name: string, message: string): void {
  addIssue(name, { source: "dev-link", message, at: new Date().toISOString() });
}

export function serveShape(record: AppRecord, deps: ServeShapeDeps = {}): ResolvedShape | null {
  if (record.managedBy === "user") {
    clearIssues(record.name, "dev-link");
    return { command: record.command!, cwd: record.workingDirectory! };
  }
  // Grandfathered: a managed row with a stored command and no dev link keeps
  // today's behavior verbatim (gitq, fresh installs, pre-migration rows).
  if (!record.dev?.workingDirectory && record.command?.length) {
    clearIssues(record.name, "dev-link");
    return { command: record.command, cwd: record.workingDirectory! };
  }

  const source = sourceShape(record);
  const bundle = deps.helpersDir !== undefined ? bundleShape(record, deps.helpersDir) : bundleShape(record);
  const linkBroken = readLinkedManifest(record).state === "broken";
  const dev = (deps.devMode ?? isDevMode)();
  const chosen = dev ? (source ?? bundle) : (bundle ?? source);

  if (!chosen) {
    issue(record.name, `no runnable shape for ${record.name} (no bundle, no valid source)`);
    return null;
  }
  if (chosen === bundle && linkBroken) {
    issue(record.name, `dev source ${record.dev!.workingDirectory} missing or invalid; running bundled`);
  } else if (chosen === source && !bundle && !dev) {
    issue(record.name, `bundle for ${record.name} not installed; serving source`);
  } else {
    clearIssues(record.name, "dev-link");
  }
  return chosen;
}
