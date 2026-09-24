/**
 * Which app (mattstack.app = prod, mattstack-dev.app = dev) this process
 * belongs to. The launcher decides, the way NODE_ENV works: each app's
 * launchd jobs carry MATTSTACK_FLAVOR in their plist, the dev source wrapper
 * at ~/.local/bin/rt exports it, and a process nobody labelled falls back to
 * what it was built as (a compiled rt is the prod app's binary, a source run
 * is dev). Nothing on disk records an intended flavor.
 */

declare const RT_VERSION: string | undefined;

export type Flavor = "dev" | "prod";

export function buildFlavor(): Flavor {
  return typeof RT_VERSION !== "undefined" ? "prod" : "dev";
}

export function processFlavor(
  env: Record<string, string | undefined> = process.env,
  built: Flavor = buildFlavor(),
): Flavor {
  const raw = env.MATTSTACK_FLAVOR;
  return raw === "dev" || raw === "prod" ? raw : built;
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
