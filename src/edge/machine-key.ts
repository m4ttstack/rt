import { readFileSync } from "fs";
import { join } from "path";
import { homedir, hostname } from "os";
import { randomBytes } from "crypto";

// Mirrors rt-client's settings/paths.ts machineKey(), which is not exported
// from its package index. Only the readable segment of the tunnel name
// depends on it; uniqueness comes from randomSuffix.
//
// HOME is resolved via process.env.HOME ?? homedir(), not homedir() alone:
// bun's os.homedir() does not pick up a process.env.HOME override at call
// time, so tests that repoint HOME at a temp dir need the env check first.
function home(): string {
  return process.env.HOME ?? homedir();
}

export function machineKey(): string {
  try {
    const v = readFileSync(join(home(), ".mattstack", "machine-key"), "utf8").trim();
    if (v.length > 0 && v !== "." && v !== ".." && !v.includes("/") && !v.includes("\\")) return v;
  } catch {
    // no override file
  }
  const slug = hostname().toLowerCase().replace(/\.local$/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "default";
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomSuffix(len = 6): string {
  const bytes = randomBytes(len);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function mintTunnelName(random: () => string = randomSuffix): string {
  return `deck-edge-${machineKey()}-${random()}`;
}
