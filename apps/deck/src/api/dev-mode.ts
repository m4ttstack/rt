import { getSetting } from "@mattstack/rt-client";

// rt's machine-flavor setting, written by `rt settings dev-mode`. Read through
// rt-client only, never by touching ~/.mattstack/rt files directly.
const MODE_KEY = "mattstack.mode";
const DEV_MODE_TTL_MS = 2000;

function defaultRead(): string | undefined {
  return getSetting<string>(MODE_KEY).value;
}

let cached: { at: number; dev: boolean } | null = null;

export function resetDevModeCache(): void {
  cached = null;
}

export function isDevMode(deps: { read?: () => string | undefined } = {}): boolean {
  const now = Date.now();
  if (cached && now - cached.at < DEV_MODE_TTL_MS) return cached.dev;
  let dev = false;
  try {
    dev = (deps.read ?? defaultRead)() === "dev";
  } catch {
    dev = false; // fail closed: a failed read counts as production
  }
  cached = { at: now, dev };
  return dev;
}
