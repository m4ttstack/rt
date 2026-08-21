// src/boot-env.ts
// MUST be main.ts's first import. ES modules evaluate a module's imports, in
// source order, fully before any of that module's own top-level code runs --
// including code written textually ABOVE a later import. A guard placed in
// main.ts's own body, even before `import { startApi } from "./api/server.ts"`
// textually, still runs AFTER core/settings.ts's eager module-level
// `cache = load()` a few imports downstream, because ESM resolves the entire
// import graph before executing the importer's own statements. Putting the
// guard in its own module and importing it FIRST is what actually orders it
// before every transitive import that reads this env var.
import { join } from "path";
import { stateDir, adoptLegacyStateDir } from "./api/state.ts";

// Local -> Deck rename (ruled): adopt a pre-rename ~/.mattstack/local into
// ~/.mattstack/deck before anything (records.ts's eager cache load, in
// particular) ever reads from stateDir() -- same import-ordering hazard as
// the settings-path guard below, so this runs from the same first-imported
// module, unconditionally (checkout and compiled binary both need it).
adoptLegacyStateDir();

// Under bun --compile, core/settings.ts's default path (import.meta.dir/../data)
// resolves inside the bundle's virtual root: settings would silently go
// nowhere. A checkout's default (<repo>/data/settings.json) must not be read
// either -- it holds real secrets (password hashes, session token) and is
// untracked scratch, never a config source. Every mode therefore defaults
// settings into the state dir.
//
// This means a checkout run now reads AND WRITES the exact same state dir a
// live compiled deck uses: `bun run serve` on a dev machine that shares
// stateDir() with production is a production mutation, not a sandboxed one
// -- a publish toggle flipped from `bun run serve` really flips it live.
// This guard performs no adoption of the old repo-tracked file's values on
// first run; those are the rotation set (compromised, being retired), not a
// seed worth carrying forward.
if (!process.env.LOCAL_APPS_SETTINGS_PATH) {
  process.env.LOCAL_APPS_SETTINGS_PATH = join(stateDir(), "settings.json");
}
