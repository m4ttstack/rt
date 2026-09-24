/**
 * Display labels for serialized repo identities. Leaf module — imported by
 * both repo-arg.ts and repo-index.ts, which already import each other's
 * neighbors; anything heavier here recreates that cycle.
 */

import { basename } from "path";
import { parseIdentity } from "./settings/identity.ts";

/** Decode a raw serialized identity into its display label (last path
    segment). Never call this on a value that will be sent back to the daemon
    as a payload key — it is already the identity there. A string that is not
    a canonical wire (legacy name rows, unregistered dirs) passes through
    unchanged. */
export function repoLabel(serialized: string): string {
  const id = parseIdentity(serialized);
  if (!id) return serialized;
  return id.kind === "remote" ? (id.id.split("/").pop() ?? id.id) : basename(id.id);
}

/** The forge host of a remote-kind identity ("github.com"); null for a
    path-kind identity or a string that is not a canonical wire. */
export function repoHost(serialized: string): string | null {
  const id = parseIdentity(serialized);
  return id?.kind === "remote" ? (id.id.split("/")[0] ?? null) : null;
}

/** What the repo's forge calls a change: "PR" on GitHub, "MR" everywhere else. */
export function changeNoun(serialized: string): "PR" | "MR" {
  return repoHost(serialized) === "github.com" ? "PR" : "MR";
}

/** The marker the forge prints before a change number: "#" on GitHub, "!" elsewhere. */
export function changeMarker(serialized: string): "#" | "!" {
  return repoHost(serialized) === "github.com" ? "#" : "!";
}

/** Longer label for disambiguating collisions: last two segments for
    remote-kind ("acme/acme-dev"), basename for path-kind (which cannot
    qualify further short of the full path — see repoLabelFull). */
export function repoLabelQualified(serialized: string): string {
  const id = parseIdentity(serialized);
  if (!id) return serialized;
  if (id.kind === "path") return basename(id.id);
  return id.id.split("/").slice(-2).join("/");
}

/** Last-resort label when even qualified labels collide: the whole decoded
    id — host/owner/name for remote-kind, the full path for path-kind. */
export function repoLabelFull(serialized: string): string {
  const id = parseIdentity(serialized);
  return id ? id.id : serialized;
}
