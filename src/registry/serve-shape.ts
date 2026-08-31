import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { bundleHelpersDir } from "../services/bundle-layout.ts";
import { readDeckManifest, type DeckManifest } from "./deck-manifest.ts";
import type { AppRecord } from "./records.ts";

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
