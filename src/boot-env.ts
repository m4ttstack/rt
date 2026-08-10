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
import { basename, join } from "path";
import { stateDir } from "./api/state.ts";

// Under bun --compile, core/settings.ts's default path (import.meta.dir/../data)
// resolves inside the bundle's virtual root: settings would silently go nowhere.
// A compiled binary therefore defaults settings into the state dir; a checkout
// (execPath is bun itself) keeps <repo>/data/settings.json, unchanged.
if (!process.env.LOCAL_APPS_SETTINGS_PATH && !basename(process.execPath).startsWith("bun")) {
  process.env.LOCAL_APPS_SETTINGS_PATH = join(stateDir(), "settings.json");
}
