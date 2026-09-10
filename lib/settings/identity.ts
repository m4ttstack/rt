// RT-50: repo identity normalization/derivation moved to @mattstack/rt-client.
// Every existing rt importer of lib/settings/identity.ts keeps working
// unchanged through this re-export barrel; the implementation lives at the
// path below.
export * from "../../packages/rt-client/src/settings/identity.ts";

/**
 * Flattens a raw identity id (host/path, or an absolute path) into one
 * dash-joined segment: "gitlab.com/acme/acme-dev" -> "gitlab.com-acme-acme-dev".
 * This mirrors merge-manifests.sh's SLUG derivation
 * (SLUG="$HOST-$(printf %s "$RPATH" | tr '/' '-')") -- the shell script that
 * actually names run dirs on disk. This and that script must stay
 * byte-for-byte in sync, or every TS caller here silently stops matching
 * the real directories and row ids the shell side produces.
 */
export function repoIdentitySlug(rawId: string): string {
  return rawId.replace(/\//g, "-");
}
