/**
 * Which app (mattstack.app = prod, mattstack-dev.app = dev) this process
 * belongs to. The launcher decides, the way NODE_ENV works: each app's
 * launchd jobs carry MATTSTACK_FLAVOR in their plist, the dev source wrapper
 * at ~/.local/bin/rt exports it, and a process nobody labelled falls back to
 * what it was built as (a compiled rt is the prod app's binary, a source run
 * is dev). Nothing on disk records an intended flavor.
 *
 * The entry points capture it once and delete the variable, so tmux, herdr
 * and agent sessions started under this process never inherit a flavor that
 * outlives the switch that set it.
 */

declare const RT_VERSION: string | undefined;

export type Flavor = "dev" | "prod";

export function buildFlavor(): Flavor {
  return typeof RT_VERSION !== "undefined" ? "prod" : "dev";
}

let captured: Flavor | null = null;

function fromEnv(env: Record<string, string | undefined>, built: Flavor): Flavor {
  const raw = env.MATTSTACK_FLAVOR;
  return raw === "dev" || raw === "prod" ? raw : built;
}

/** The captured flavor when an entry point took one, else read from `env` now. */
export function processFlavor(env?: Record<string, string | undefined>, built: Flavor = buildFlavor()): Flavor {
  if (env === undefined) return captured ?? fromEnv(process.env, built);
  return fromEnv(env, built);
}

/** Called first thing by cli.ts and the daemon's own entry. */
export function captureProcessFlavor(env: Record<string, string | undefined> = process.env): Flavor {
  captured = fromEnv(env, buildFlavor());
  delete env.MATTSTACK_FLAVOR;
  return captured;
}

export function __resetCapturedFlavor(): void {
  captured = null;
}

export function otherFlavor(flavor: Flavor): Flavor {
  return flavor === "dev" ? "prod" : "dev";
}

export function daemonLabelFor(flavor: Flavor): string {
  return flavor === "dev" ? "com.mattstack.daemon.dev" : "com.mattstack.daemon";
}

export function deckLabelFor(flavor: Flavor): string {
  return flavor === "dev" ? "com.mattstack.deck.dev" : "com.mattstack.deck";
}
