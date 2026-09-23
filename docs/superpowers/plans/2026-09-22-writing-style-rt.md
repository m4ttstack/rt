# Writing style in rt (CLI, setup, app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user choose the voice of prose posted under their name: a registered setting, a resolver and `rt skills writing-style` verbs, personal styles in the home repo, a finish-gated setup row with a native picker, and the same picker in Settings.

**Architecture:** `lib/skills/writing-style.ts` owns the lookup order (setting, `preferences.md`, conversational fallback). `lib/skills/writing-style-sources.ts` inventories installed and personal styles. `commands/skills-writing-style.ts` exposes `show`, `list`, `use`, `new`. The setup row is a pure function in `lib/setup/validators/writing-style.ts`, fed by the `tools` group's existing plugin listing; a new `choose` contract action and a `waivable` row field drive the app. The app gets a `ChooseSheet` used from the checklist, the Done screen and Settings › General, all through one `ChoiceClient` that runs the `use` verb and reports failures inside the sheet.

**Tech Stack:** Bun, TypeScript, `bun:test`; Swift/SwiftUI (`rt-tray`), `swift run mattstack-checks`.

**Spec:** `docs/superpowers/specs/2026-09-22-writing-style-presets-design.md` (sections 1 to 5). The `agentSafe` flag comes from `docs/superpowers/specs/2026-09-22-rt-verb-mcp-tool-design.md`.

## Global Constraints

- Setting key `skills.writingStyle`: string, scopes `["user", "team"]`, merge `replace`, **no `default`**.
- Fallback skill `mattstack:writing-style-conversational`. Presets: `mattstack:writing-style-sparse`, `-conversational`, `-structured`; always valid regardless of install state.
- Skill id shape `^[a-z0-9][a-z0-9._-]*(:[a-z0-9._-]+)?$`; `new` names `^[a-z0-9][a-z0-9._-]*$`.
- Every `--json` output is `envelope(...)` from `lib/setup/contract.ts`; every refusal is exit 2 with `userErrorPayload` (`lib/setup/errors.ts`). Codes: `usage`, `bad-id`, `unknown-skill`, `no-home-repo`, `bad-name`, `bad-preset`, `exists`, `no-plugin`.
- `use` and `new` refuse with `no-home-repo` while `homeGitDir(home)` (`lib/setup/steps/home.ts`) is absent, and write nothing.
- Row id `skills.writing-style`, group tools, `kind: "tool"`, `finishGated: true`, not waivable. Before Install: `needs-you`, no action.
- Pickers gate on `isTTY && !json && !RT_BATCH`; the non-TTY path keeps its usage error and exit code.
- The TS CLI is UI-free (no JSX, no UI frameworks); prompts go through `lib/pick-wrappers.ts` / `lib/ui/prompts.ts`.
- Clean-code comments only. No em or en dashes anywhere.
- Never rebuild, re-sign or reinstall `/Applications/mattstack.app` or `rt-tray/mattstack-dev.app`; UI verification uses a debug `swift build` run in stub mode. Launching the app opens a window on the operator's desktop: ask first.
- Run `bun run test:all` before calling anything verified.
- `agentSafe: true` on `show` (Task 12) lands only after the RT-244 lane has merged.

## Review Focus

- A team default naming a preset on a fresh Mac with no mattstack plugin yet: reads `ready`, never `invalid` (Task 8 test).
- `rt settings set setup.waived '["skills.writing-style"]' --scope machine`: the row still blocks Finish (Task 7 test).
- An older rt that omits `waivable` on the Fast Browser row: a new app still shows Skip (Task 9 check).
- The "Use my own skill…" field given `-rf` or `../x`: `bad-id`, exit 2, readable in the sheet (Task 5 test, Task 9 check, Task 10 render).
- `use` run before Install (`~/.mattstack/user/.git` absent): `no-home-repo`, and `~/.mattstack/user` is not created (Task 5 test).

---

### Task 1: The setting

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (new block before the closing `];`)
- Test: `packages/rt-client/src/settings/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `describe("allDefs", ...)` in `registry.test.ts`:

```ts
    test("skills.writingStyle is a user+team string with no default (unset is what makes the setup row ask)", () => {
      const def = getDef("skills.writingStyle");
      expect(def).toBeDefined();
      expect(def!.type).toBe("string");
      expect(def!.scopes).toEqual(["user", "team"]);
      expect(def!.merge).toBe("replace");
      expect(def!.default).toBeUndefined();
    });
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: FAIL, `def` undefined.

- [ ] **Step 3: Add the row**

Before the final `];` of the defs array in `registry-defs.ts`:

```ts
  // --- skills (writing style) ----------------------------------------------
  // No `default`: an unset key is what makes the setup row read needs-you.
  // The conversational fallback lives in the resolver, never in this row.
  {
    key: "skills.writingStyle",
    type: "string",
    scopes: ["user", "team"],
    merge: "replace",
    description: "Skill id that sets the voice for prose posted under your name (reviews, replies, PR descriptions). A team value is the default a member's user value overrides.",
  },
```

The same test file pins the full key set: add `"skills.writingStyle"` to the
`suiteKeys` list (around line 271) and change its `toHaveLength(75)` to
`toHaveLength(76)`. That failure before the edit is expected, not a sign the
row is wrong.

- [ ] **Step 4: Run tests and rebuild the client**

Run: `bun test packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: PASS.
Run: `cd packages/rt-client && bun run build && cd ../.. && bun test packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/settings/__tests__/registry.test.ts
git commit -m "settings: register skills.writingStyle (user+team, no default)"
```

---

### Task 2: The resolver and preset catalog

**Files:**
- Create: `lib/skills/writing-style.ts`
- Test: `lib/skills/__tests__/writing-style.test.ts`

**Interfaces:**
- Produces:
  - `WRITING_STYLE_KEY = "skills.writingStyle"`, `FALLBACK_WRITING_STYLE`
  - `WRITING_STYLE_PRESETS: readonly { id; label; detail; sample }[]`
  - `isValidSkillId(id: string): boolean`, `isPresetId(id: string): boolean`, `presetById(id: string)`
  - `parsePreferencesStyle(text: string): string | null`
  - `preferencesPath(home: string): string`
  - `type WritingStyleSource = "user" | "team" | "preferences" | "fallback"`
  - `resolveWritingStyle(opts?: { home?: string; read?: (key: string) => Resolved<unknown> }): { skill: string; source: WritingStyleSource }`

- [ ] **Step 1: Write the failing tests**

`lib/skills/__tests__/writing-style.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Resolved } from "../../settings/resolve.ts";
import {
  FALLBACK_WRITING_STYLE, isPresetId, isValidSkillId, parsePreferencesStyle, preferencesPath, resolveWritingStyle,
} from "../writing-style.ts";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-writing-style-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const unset = (): Resolved<unknown> => ({ value: undefined, provenance: [] });
const at = (value: unknown, scope: "user" | "team"): Resolved<unknown> => ({ value, provenance: [{ scope, file: `/x/${scope}.jsonc` }] });

function writePrefs(text: string) {
  const path = preferencesPath(home);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

describe("isValidSkillId", () => {
  test("accepts plugin:name and bare names; refuses flags and paths", () => {
    for (const ok of ["mattstack:writing-style-sparse", "matt:matts-writing-style", "my-voice", "a.b_c"]) expect(isValidSkillId(ok)).toBe(true);
    for (const bad of ["-rf", "../x", "a/b", "", "Upper", "a:b:c", " x"]) expect(isValidSkillId(bad)).toBe(false);
  });
});

describe("parsePreferencesStyle", () => {
  test("reads the backticked value on the keyed line", () => {
    expect(parsePreferencesStyle("## Writing style\n\nwriting-style: `matt:matts-writing-style`\n\nLoad it first.\n")).toBe("matt:matts-writing-style");
  });
  test("reads an unquoted value", () => {
    expect(parsePreferencesStyle("## Writing style\nwriting-style: my-voice\n")).toBe("my-voice");
  });
  test("no keyed line, no section, or a keyed line in another section reads nothing", () => {
    expect(parsePreferencesStyle("## Writing style\nLoad `x:y` before drafting.\n")).toBeNull();
    expect(parsePreferencesStyle("## Dev process runner\nwriting-style: `x:y`\n")).toBeNull();
    expect(parsePreferencesStyle("## Writing style\n\n## Other\nwriting-style: `x:y`\n")).toBeNull();
  });
  test("an invalid id reads nothing", () => {
    expect(parsePreferencesStyle("## Writing style\nwriting-style: `-rf`\n")).toBeNull();
  });
});

describe("resolveWritingStyle", () => {
  test("a user value wins over preferences.md", () => {
    writePrefs("## Writing style\nwriting-style: `x:from-prefs`\n");
    expect(resolveWritingStyle({ home, read: () => at("mattstack:writing-style-sparse", "user") })).toEqual({ skill: "mattstack:writing-style-sparse", source: "user" });
  });
  test("a team value reads as the team default", () => {
    expect(resolveWritingStyle({ home, read: () => at("mattstack:writing-style-structured", "team") })).toEqual({ skill: "mattstack:writing-style-structured", source: "team" });
  });
  test("preferences.md is the second rung", () => {
    writePrefs("## Writing style\nwriting-style: `matt:matts-writing-style`\n");
    expect(resolveWritingStyle({ home, read: unset })).toEqual({ skill: "matt:matts-writing-style", source: "preferences" });
  });
  test("nothing anywhere falls back to conversational", () => {
    expect(resolveWritingStyle({ home, read: unset })).toEqual({ skill: FALLBACK_WRITING_STYLE, source: "fallback" });
    expect(isPresetId(FALLBACK_WRITING_STYLE)).toBe(true);
  });
  test("an invalid stored value is skipped, not returned", () => {
    expect(resolveWritingStyle({ home, read: () => at("-rf", "user") }).source).toBe("fallback");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun test lib/skills/__tests__/writing-style.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`lib/skills/writing-style.ts`:

```ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getSetting, type Resolved } from "../settings/resolve.ts";

export const WRITING_STYLE_KEY = "skills.writingStyle";
export const FALLBACK_WRITING_STYLE = "mattstack:writing-style-conversational";

export interface WritingStylePreset {
  id: string;
  label: string;
  detail: string;
  sample: string;
}

export const WRITING_STYLE_PRESETS: readonly WritingStylePreset[] = [
  {
    id: "mattstack:writing-style-sparse",
    label: "Sparse",
    detail: "Terse, lowercase for technical points, one tight paragraph per finding.",
    sample: "**issue:** cache is keyed on userId alone, so two tenants share an entry. key on (tenant, id)?",
  },
  {
    id: "mattstack:writing-style-conversational",
    label: "Conversational",
    detail: "Short, friendly sentences in sentence case, like talking to a teammate.",
    sample: "**issue:** The cache is keyed on userId alone, so two tenants can share an entry. Could we key on both?",
  },
  {
    id: "mattstack:writing-style-structured",
    label: "Structured",
    detail: "Labelled lines and short bullets for teams that like formal write-ups.",
    sample: "**issue:** Settings leak across tenants. Why: the cache key omits the tenant. Suggestion: key on (tenant, id).",
  },
];

export type WritingStyleSource = "user" | "team" | "preferences" | "fallback";

export interface ResolvedWritingStyle {
  skill: string;
  source: WritingStyleSource;
}

const SKILL_ID_RE = /^[a-z0-9][a-z0-9._-]*(:[a-z0-9._-]+)?$/;

export function isValidSkillId(id: string): boolean {
  return SKILL_ID_RE.test(id);
}

export function presetById(id: string): WritingStylePreset | undefined {
  return WRITING_STYLE_PRESETS.find((p) => p.id === id);
}

export function isPresetId(id: string): boolean {
  return presetById(id) !== undefined;
}

export function preferencesPath(home: string): string {
  return join(home, ".mattstack", "user", "skills", "preferences.md");
}

/** Only the `writing-style:` line of the `## Writing style` section counts; prose mentioning a skill does not. */
export function parsePreferencesStyle(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === "## writing style");
  if (start === -1) return null;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) return null;
    const m = /^\s*writing-style:\s*`?([^`\s]+)`?\s*$/.exec(line);
    if (m) return isValidSkillId(m[1]!) ? m[1]! : null;
  }
  return null;
}

export function resolveWritingStyle(opts: { home?: string; read?: (key: string) => Resolved<unknown> } = {}): ResolvedWritingStyle {
  const home = opts.home ?? process.env.HOME ?? "";
  const read = opts.read ?? ((key: string) => getSetting<unknown>(key));

  const configured = read(WRITING_STYLE_KEY);
  if (typeof configured.value === "string" && isValidSkillId(configured.value)) {
    const scope = configured.provenance.at(-1)?.scope;
    return { skill: configured.value, source: scope === "team" ? "team" : "user" };
  }

  const path = preferencesPath(home);
  const fromPreferences = existsSync(path) ? parsePreferencesStyle(readFileSync(path, "utf8")) : null;
  if (fromPreferences) return { skill: fromPreferences, source: "preferences" };

  return { skill: FALLBACK_WRITING_STYLE, source: "fallback" };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/skills/__tests__/writing-style.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/writing-style.ts lib/skills/__tests__/writing-style.test.ts
git commit -m "skills: writing-style resolver and preset catalog"
```

---

### Task 3: Style inventory and personal-skill linking

**Files:**
- Create: `lib/skills/writing-style-sources.ts`
- Modify: `lib/setup/steps/skills.ts` (`skillsLinkRun` links personal skills first)
- Test: `lib/skills/__tests__/writing-style-sources.test.ts`; modify `lib/setup/__tests__/steps-*.test.ts` covering `skills.link` (find it with `rg -l "skills.link" lib/setup/__tests__`)

**Interfaces:**
- Consumes: `WRITING_STYLE_PRESETS`, `isPresetId`, `presetById`, `ResolvedWritingStyle` (Task 2); `reconcileSkillLinks`, `ReconcileResult` (`lib/skills/link.ts`); `stripFrontmatter` (`lib/skills/sources.ts`).
- Produces:
  - `interface PluginEntry { id: string; enabled: boolean; installPath: string | null }`
  - `parsePluginEntries(stdout: string): PluginEntry[] | null`
  - `interface SkillInventory { installed: Set<string>; disabledPluginFor: Map<string, string>; personal: { name: string; dir: string }[] }`
  - `readSkillInventory(home: string, plugins: PluginEntry[] | null): SkillInventory`
  - `isStyleUsable(id: string, inv: SkillInventory): boolean`
  - `interface WritingStyleOption { id; label; detail; sample?; kind: "preset" | "personal" | "installed"; installed: boolean }`
  - `listWritingStyles(inv: SkillInventory, current: ResolvedWritingStyle): { current: ResolvedWritingStyle; options: WritingStyleOption[] }`
  - `personalSkillsDir(home: string): string`
  - `linkPersonalSkills(home: string): ReconcileResult | null`

- [ ] **Step 1: Write the failing tests**

`lib/skills/__tests__/writing-style-sources.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isStyleUsable, linkPersonalSkills, listWritingStyles, parsePluginEntries, personalSkillsDir, readSkillInventory,
} from "../writing-style-sources.ts";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-ws-sources-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

function skill(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\nbody\n`);
}

function plugin(id: string, enabled: boolean, skills: string[], manifestSkills?: string[]) {
  const installPath = join(home, "cache", id);
  mkdirSync(join(installPath, ".claude-plugin"), { recursive: true });
  writeFileSync(join(installPath, ".claude-plugin", "plugin.json"), JSON.stringify({ name: id.split("@")[0], version: "1.0.0", ...(manifestSkills ? { skills: manifestSkills } : {}) }));
  for (const s of skills) skill(join(installPath, "skills", s), s);
  return { id, enabled, installPath };
}

describe("parsePluginEntries", () => {
  test("keeps id, enabled and installPath", () => {
    expect(parsePluginEntries('[{"id":"a@m","enabled":true,"installPath":"/p"},{"id":"b@m"}]')).toEqual([
      { id: "a@m", enabled: true, installPath: "/p" },
      { id: "b@m", enabled: false, installPath: null },
    ]);
  });
  test("rejects a non-array or an entry without an id", () => {
    expect(parsePluginEntries("nope")).toBeNull();
    expect(parsePluginEntries('[{"enabled":true}]')).toBeNull();
  });
});

describe("readSkillInventory", () => {
  test("enabled plugin skills are installed; disabled ones name the plugin to enable", () => {
    const inv = readSkillInventory(home, [plugin("team@m", true, ["team-writing-style"]), plugin("off@m", false, ["off-writing-style"])]);
    expect(inv.installed.has("team:team-writing-style")).toBe(true);
    expect(inv.installed.has("off:off-writing-style")).toBe(false);
    expect(inv.disabledPluginFor.get("off:off-writing-style")).toBe("off@m");
  });

  test("a manifest skills root other than ./skills is honored", () => {
    const p = plugin("alt@m", true, [], ["./skills", "./plugin/skills"]);
    skill(join(p.installPath, "plugin", "skills", "alt-writing-style"), "alt-writing-style");
    expect(readSkillInventory(home, [p]).installed.has("alt:alt-writing-style")).toBe(true);
  });

  test("~/.claude/skills entries are installed; personal skills are listed", () => {
    skill(join(home, ".claude", "skills", "matt:matts-writing-style"), "matt:matts-writing-style");
    skill(join(personalSkillsDir(home), "my-voice"), "my-voice");
    const inv = readSkillInventory(home, null);
    expect(inv.installed.has("matt:matts-writing-style")).toBe(true);
    expect(inv.personal.map((s) => s.name)).toEqual(["my-voice"]);
  });
});

describe("isStyleUsable and listWritingStyles", () => {
  test("presets are usable with no plugin at all", () => {
    expect(isStyleUsable("mattstack:writing-style-sparse", readSkillInventory(home, null))).toBe(true);
    expect(isStyleUsable("nobody:writing-style-x", readSkillInventory(home, null))).toBe(false);
  });

  test("lists presets, personal and installed styles once each, with current", () => {
    const mattstack = plugin("mattstack@mattstack", true, ["writing-style-sparse"]);
    skill(join(home, ".claude", "skills", "matt:matts-writing-style"), "matt:matts-writing-style");
    skill(join(personalSkillsDir(home), "my-voice"), "my-voice");
    const inv = readSkillInventory(home, [mattstack]);
    const out = listWritingStyles(inv, { skill: "matt:matts-writing-style", source: "user" });
    expect(out.current).toEqual({ skill: "matt:matts-writing-style", source: "user" });
    const ids = out.options.map((o) => o.id);
    expect(ids.slice(0, 3)).toEqual(["mattstack:writing-style-sparse", "mattstack:writing-style-conversational", "mattstack:writing-style-structured"]);
    expect(ids.filter((id) => id === "mattstack:writing-style-sparse")).toHaveLength(1);
    expect(out.options.find((o) => o.id === "mattstack:writing-style-sparse")?.kind).toBe("preset");
    expect(out.options.find((o) => o.id === "my-voice")?.kind).toBe("personal");
    expect(out.options.find((o) => o.id === "matt:matts-writing-style")?.kind).toBe("installed");
  });
});

describe("linkPersonalSkills", () => {
  test("links personal skill directories into ~/.claude/skills and ignores plain files", () => {
    const dir = personalSkillsDir(home);
    skill(join(dir, "my-voice"), "my-voice");
    writeFileSync(join(dir, "preferences.md"), "## Writing style\n");
    linkPersonalSkills(home);
    expect(lstatSync(join(home, ".claude", "skills", "my-voice")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, ".claude", "skills", "preferences.md"))).toBe(false);
  });

  test("no personal skills directory is a no-op", () => {
    expect(linkPersonalSkills(home)).toBeNull();
  });
});
```

Keep `symlinkSync` out of the import list if unused.

- [ ] **Step 2: Run to see it fail**

Run: `bun test lib/skills/__tests__/writing-style-sources.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`lib/skills/writing-style-sources.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { reconcileSkillLinks, type ReconcileResult } from "./link.ts";
import { stripFrontmatter } from "./sources.ts";
import { WRITING_STYLE_PRESETS, isPresetId, type ResolvedWritingStyle } from "./writing-style.ts";

export interface PluginEntry {
  id: string;
  enabled: boolean;
  installPath: string | null;
}

/** Unlike pack-cache's parsePluginList, keeps installPath: plugin skill directories live under it. */
export function parsePluginEntries(stdout: string): PluginEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: PluginEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || typeof (item as { id?: unknown }).id !== "string") return null;
    const e = item as { id: string; enabled?: unknown; installPath?: unknown };
    out.push({ id: e.id, enabled: e.enabled === true, installPath: typeof e.installPath === "string" ? e.installPath : null });
  }
  return out;
}

function childDirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function skillDirNames(root: string): string[] {
  return childDirs(root).filter((name) => existsSync(join(root, name, "SKILL.md")));
}

/** Mirrors Claude Code: the manifest's `skills` roots, each scanned one level deep; `./skills` when absent. */
function pluginSkillRoots(installPath: string): string[] {
  let roots: string[] = ["./skills"];
  try {
    const manifest = JSON.parse(readFileSync(join(installPath, ".claude-plugin", "plugin.json"), "utf8")) as { skills?: unknown };
    if (typeof manifest.skills === "string") roots = [manifest.skills];
    else if (Array.isArray(manifest.skills)) roots = manifest.skills.filter((r): r is string => typeof r === "string");
  } catch {
    // an unreadable manifest still gets the default root
  }
  return roots.map((r) => resolve(installPath, r));
}

export function personalSkillsDir(home: string): string {
  return join(home, ".mattstack", "user", "skills");
}

export interface SkillInventory {
  installed: Set<string>;
  disabledPluginFor: Map<string, string>;
  personal: { name: string; dir: string }[];
}

function frontmatterName(dir: string): string | null {
  try {
    const name = stripFrontmatter(readFileSync(join(dir, "SKILL.md"), "utf8")).frontmatter.name;
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

export function readSkillInventory(home: string, plugins: PluginEntry[] | null): SkillInventory {
  const installed = new Set<string>();
  const disabledPluginFor = new Map<string, string>();

  const claudeSkills = join(home, ".claude", "skills");
  for (const name of skillDirNames(claudeSkills)) installed.add(name);

  for (const plugin of plugins ?? []) {
    if (!plugin.installPath) continue;
    const pluginName = plugin.id.split("@")[0]!;
    for (const root of pluginSkillRoots(plugin.installPath)) {
      for (const dir of skillDirNames(root)) {
        const id = `${pluginName}:${dir}`;
        if (plugin.enabled) {
          installed.add(id);
          disabledPluginFor.delete(id);
        } else if (!installed.has(id)) {
          disabledPluginFor.set(id, plugin.id);
        }
      }
    }
  }

  const personalRoot = personalSkillsDir(home);
  const personal = skillDirNames(personalRoot).flatMap((dirName) => {
    const dir = join(personalRoot, dirName);
    const name = frontmatterName(dir);
    return name ? [{ name, dir }] : [];
  });

  return { installed, disabledPluginFor, personal };
}

export function isStyleUsable(id: string, inv: SkillInventory): boolean {
  return isPresetId(id) || inv.installed.has(id);
}

export interface WritingStyleOption {
  id: string;
  label: string;
  detail: string;
  sample?: string;
  kind: "preset" | "personal" | "installed";
  installed: boolean;
}

export function listWritingStyles(inv: SkillInventory, current: ResolvedWritingStyle): { current: ResolvedWritingStyle; options: WritingStyleOption[] } {
  const options: WritingStyleOption[] = WRITING_STYLE_PRESETS.map((p) => ({
    id: p.id, label: p.label, detail: p.detail, sample: p.sample, kind: "preset", installed: inv.installed.has(p.id),
  }));
  const seen = new Set(options.map((o) => o.id));
  for (const s of inv.personal) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    options.push({ id: s.name, label: s.name, detail: "Your own style, in your home repo", kind: "personal", installed: inv.installed.has(s.name) });
  }
  for (const id of [...inv.installed].sort()) {
    if (seen.has(id) || !id.includes("writing-style")) continue;
    seen.add(id);
    options.push({ id, label: id, detail: "An installed skill", kind: "installed", installed: true });
  }
  return { current, options };
}

/** Links only into ~/.claude/skills and only prunes links pointing into the personal directory. */
export function linkPersonalSkills(home: string): ReconcileResult | null {
  const dir = personalSkillsDir(home);
  if (!existsSync(dir)) return null;
  return reconcileSkillLinks({ skillsDir: dir, claudeSkillsDir: join(home, ".claude", "skills") });
}
```

In `lib/setup/steps/skills.ts`, make personal linking the first thing `skillsLinkRun` does, before the app-bundle early return, and fold its count into the detail:

```ts
async function skillsLinkRun(ctx: ApplyContext): Promise<StepOutcome> {
  const personal = linkPersonalSkills(ctx.p.home);
  const personalNote = personal ? `, ${personal.actions.filter((a) => a.kind === "create" || a.kind === "relink" || a.kind === "ok").length} personal` : "";

  const root = appBundlePath(ctx.p);
  if (!root) return personal ? { state: "done", detail: `linked personal skills only (not running from an app bundle)${personalNote}` } : { state: "skipped", detail: "not running from an app bundle" };

  const results = linkBundledSkills({
    skillsRoot: join(root, HELPERS_DIR, "skills"),
    claudeSkillsDir: join(ctx.p.home, ".claude", "skills"),
    isBundled: (app) => bundledToolPath(ctx.p, app) !== null,
  });
  if (results.length === 0) return personal ? { state: "done", detail: `bundle ships no skills${personalNote}` } : { state: "skipped", detail: "bundle ships no skills" };

  for (const r of results.filter((x) => x.skipped)) ctx.log("skills.link", `${r.app}: ${r.skipped}`);
  const linked = results.filter((r) => !r.skipped);
  const total = linked.reduce((n, r) => n + r.linked, 0);
  return { state: "done", detail: `linked ${total} skill(s) from ${linked.length} app(s)${personalNote}` };
}
```

with `import { linkPersonalSkills } from "../../skills/writing-style-sources.ts";`. Read `LinkAction`'s kinds in `lib/skills/link.ts` and keep the count expression consistent with them.

Add a step test in the file that already covers `skills.link`: with no app bundle and a personal skill under `<home>/.mattstack/user/skills/my-voice/`, the step returns `done` and `<home>/.claude/skills/my-voice` is a symlink. Follow that file's existing ApplyContext fake.

- [ ] **Step 4: Run tests**

Run: `bun test lib/skills/__tests__/writing-style-sources.test.ts lib/setup/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/writing-style-sources.ts lib/skills/__tests__/writing-style-sources.test.ts lib/setup/steps/skills.ts lib/setup/__tests__
git commit -m "skills: writing-style inventory; link personal skills in skills.link"
```

---

### Task 4: `show` and `list`

**Files:**
- Create: `commands/skills-writing-style.ts`
- Modify: `lib/command-tree-def.ts` (new `writing-style` branch under `skills`), `lib/module-registry.ts`
- Test: `commands/__tests__/skills-writing-style.test.ts`; `e2e/tests/skills-writing-style.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces: `writingStyleShow`, `writingStyleList`, `writingStyleUse`, `writingStyleNew` (the last two filled in Tasks 5 and 6), and `interface WritingStyleDeps` below.

- [ ] **Step 1: Write the failing tests**

`commands/__tests__/skills-writing-style.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writingStyleList, writingStyleShow, type WritingStyleDeps } from "../skills-writing-style.ts";

class Exit extends Error { constructor(public code: number) { super(`exit ${code}`); } }

let home: string;
let out: string[];
let writes: { key: string; value: unknown; scope: string }[];
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-ws-cmd-")); out = []; writes = []; });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

export function fakeDeps(over: Partial<WritingStyleDeps> = {}): WritingStyleDeps {
  return {
    home: () => home,
    now: () => new Date("2026-09-22T00:00:00Z"),
    print: (s) => { out.push(s); },
    exit: (code) => { throw new Exit(code); },
    isTTY: () => false,
    pick: async () => null,
    prompt: async () => null,
    pluginListStdout: async () => "[]",
    writeSetting: (key, value, scope) => { writes.push({ key, value, scope }); },
    resolve: () => ({ skill: "mattstack:writing-style-conversational", source: "fallback" }),
    ...over,
  };
}

describe("show", () => {
  test("--json prints the envelope with skill and source", async () => {
    await writingStyleShow(["--json"], {}, fakeDeps());
    expect(JSON.parse(out[0]!)).toEqual({ contract: 1, at: "2026-09-22T00:00:00.000Z", skill: "mattstack:writing-style-conversational", source: "fallback" });
  });
  test("plain output names the skill and where it came from", async () => {
    await writingStyleShow([], {}, fakeDeps({ resolve: () => ({ skill: "mattstack:writing-style-sparse", source: "team" }) }));
    expect(out[0]).toBe("mattstack:writing-style-sparse (team default)");
  });
});

describe("list", () => {
  test("--json carries current and the presets first", async () => {
    await writingStyleList(["--json"], {}, fakeDeps());
    const body = JSON.parse(out[0]!);
    expect(body.current).toEqual({ skill: "mattstack:writing-style-conversational", source: "fallback" });
    expect(body.options.slice(0, 3).map((o: { id: string }) => o.id)).toEqual([
      "mattstack:writing-style-sparse", "mattstack:writing-style-conversational", "mattstack:writing-style-structured",
    ]);
  });
});
```

`fakeDeps` and the `Exit` class are reused by Tasks 5 and 6 in the same file.

`e2e/tests/skills-writing-style.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createTestHome, rt } from "../harness.ts";

describe("rt skills writing-style show", () => {
  test("--json on a fresh home resolves to the conversational fallback", async () => {
    const { path: home, cleanup } = createTestHome();
    try {
      const res = await rt(["skills", "writing-style", "show", "--json"], { home });
      expect(res.exitCode).toBe(0);
      const body = JSON.parse(res.stdout);
      expect(body.contract).toBe(1);
      expect(body.skill).toBe("mattstack:writing-style-conversational");
      expect(body.source).toBe("fallback");
    } finally {
      cleanup();
    }
  });
});
```

Check `rt`'s `RunOpts` in `e2e/harness.ts` for how a test passes its HOME, and match it.

- [ ] **Step 2: Run to see it fail**

Run: `bun test commands/__tests__/skills-writing-style.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement the module with `show` and `list`**

`commands/skills-writing-style.ts`:

```ts
import { existsSync } from "fs";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, userErrorPayload } from "../lib/setup/errors.ts";
import { execWithTimeout } from "../lib/setup/probes.ts";
import { homeGitDir } from "../lib/setup/steps/home.ts";
import { setSetting } from "../lib/settings/write.ts";
import { presetById, resolveWritingStyle, type ResolvedWritingStyle } from "../lib/skills/writing-style.ts";
import { listWritingStyles, parsePluginEntries, readSkillInventory } from "../lib/skills/writing-style-sources.ts";
import type { CommandContext } from "../lib/command-tree.ts";

export interface WritingStyleDeps {
  home: () => string;
  now: () => Date;
  print: (s: string) => void;
  exit: (code: number) => never;
  isTTY: () => boolean;
  pick: (message: string, options: { value: string; label: string; hint?: string }[]) => Promise<string | null>;
  prompt: (message: string) => Promise<string | null>;
  pluginListStdout: () => Promise<string | null>;
  writeSetting: (key: string, value: unknown, scope: "user" | "team") => void;
  resolve: () => ResolvedWritingStyle;
}

export function realWritingStyleDeps(): WritingStyleDeps {
  return {
    home: () => process.env.HOME ?? "",
    now: () => new Date(),
    print: (s) => console.log(s),
    exit: process.exit,
    isTTY: () => process.stdin.isTTY === true,
    pick: async (message, options) => {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      return filterableSelect({ message, options, stderr: true });
    },
    prompt: async (message) => {
      const { textInput } = await import("../lib/ui/prompts.ts");
      const v = await textInput({ message, stderr: true });
      return v.trim() === "" ? null : v.trim();
    },
    pluginListStdout: async () => {
      const res = await execWithTimeout([resolveClaudeBin() ?? "claude", "plugin", "list", "--json"], { timeoutMs: 15_000 });
      return res.code === 0 ? res.stdout : null;
    },
    writeSetting: (key, value, scope) => setSetting(key, value, scope),
    resolve: () => resolveWritingStyle(),
  };
}

const SOURCE_LABEL: Record<ResolvedWritingStyle["source"], string> = {
  user: "yours",
  team: "team default",
  preferences: "from preferences.md",
  fallback: "not chosen; conversational fallback",
};

function refuse(err: UserActionableError, json: boolean, verb: string, deps: WritingStyleDeps): never {
  deps.print(json ? JSON.stringify(userErrorPayload(err, deps.now())) : `rt skills writing-style ${verb}: ${err.message}`);
  return deps.exit(2);
}

async function inventory(deps: WritingStyleDeps) {
  const stdout = await deps.pluginListStdout();
  return readSkillInventory(deps.home(), stdout === null ? null : parsePluginEntries(stdout));
}

export async function writingStyleShow(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const resolved = deps.resolve();
  if (args.includes("--json")) {
    deps.print(JSON.stringify(envelope({ skill: resolved.skill, source: resolved.source }, deps.now())));
    return;
  }
  deps.print(`${resolved.skill} (${SOURCE_LABEL[resolved.source]})`);
}

export async function writingStyleList(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const listing = listWritingStyles(await inventory(deps), deps.resolve());
  if (args.includes("--json")) {
    deps.print(JSON.stringify(envelope(listing, deps.now())));
    return;
  }
  for (const o of listing.options) {
    const mark = o.id === listing.current.skill ? "*" : " ";
    deps.print(`${mark} ${o.id.padEnd(40)} ${o.detail}${o.installed || o.kind === "preset" ? "" : " (not installed here)"}`);
  }
}
```

Check `resolveClaudeBin`'s export name in `lib/claude-bin.ts:12` and that `CommandContext` is exported from `lib/command-tree.ts` (it is used by other commands the same way); fix the imports if either differs. Unused imports added for Tasks 5 and 6 (`existsSync`, `homeGitDir`, `presetById`) may be added in those tasks instead.

In `lib/command-tree-def.ts`, inside `skills.subcommands`, add:

```ts
      "writing-style": {
        description: "Show, list, choose, or start the voice for prose posted under your name",
        subcommands: {
          show: {
            description: "The writing style your reviews and replies use, and where it comes from",
            module: "./commands/skills-writing-style.ts",
            fn: "writingStyleShow",
            args: [SETUP_JSON_ARG],
          },
          list: {
            description: "Writing styles you can choose: the presets, your own, and installed ones",
            module: "./commands/skills-writing-style.ts",
            fn: "writingStyleList",
            args: [SETUP_JSON_ARG],
          },
        },
      },
```

In `lib/module-registry.ts`, add beside the other skills modules:

```ts
  "./commands/skills-writing-style.ts": () => import("../commands/skills-writing-style.ts"),
```

- [ ] **Step 4: Run tests**

Run: `bun test commands/__tests__/skills-writing-style.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/no-ui-in-cli.test.ts lib/__tests__/no-eager-tui.test.ts`
Expected: PASS.
Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/skills-writing-style.test.ts`
Expected: PASS.
Run: `bun run docs:gen && bun run docs:check`
Expected: the generated command reference under `website/docs/reference/`
gains the new verbs, and the check passes (CI fails on reference drift).

- [ ] **Step 5: Commit**

```bash
git add commands/skills-writing-style.ts commands/__tests__/skills-writing-style.test.ts lib/command-tree-def.ts lib/module-registry.ts e2e/tests/skills-writing-style.test.ts website/docs/reference
git commit -m "skills writing-style: show and list"
```

---

### Task 5: `use`

**Files:**
- Modify: `commands/skills-writing-style.ts`, `lib/command-tree-def.ts`
- Test: `commands/__tests__/skills-writing-style.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `commands/__tests__/skills-writing-style.test.ts` (import `writingStyleUse`, and `existsSync`, `lstatSync`, `writeFileSync` from `fs`):

```ts
describe("use", () => {
  const homeRepo = () => mkdirSync(join(home, ".mattstack", "user", ".git"), { recursive: true });

  test("refuses before Install and writes nothing", async () => {
    await expect(writingStyleUse(["mattstack:writing-style-sparse", "--json"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("no-home-repo");
    expect(writes).toEqual([]);
    expect(existsSync(join(home, ".mattstack", "user"))).toBe(false);
  });

  test("writes a preset at user scope with the plugin absent", async () => {
    homeRepo();
    await writingStyleUse(["mattstack:writing-style-sparse", "--json"], {}, fakeDeps({ pluginListStdout: async () => null }));
    expect(writes).toEqual([{ key: "skills.writingStyle", value: "mattstack:writing-style-sparse", scope: "user" }]);
    const body = JSON.parse(out[0]!);
    expect(body.skill).toBe("mattstack:writing-style-sparse");
    expect(body.scope).toBe("user");
  });

  test("--scope team writes the team default", async () => {
    homeRepo();
    await writingStyleUse(["mattstack:writing-style-structured", "--scope", "team", "--json"], {}, fakeDeps());
    expect(writes[0]!.scope).toBe("team");
  });

  test("a bad id shape is bad-id; an unknown skill is unknown-skill listing the choices", async () => {
    homeRepo();
    await expect(writingStyleUse(["-rf", "--json"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("bad-id");
    out.length = 0;
    await expect(writingStyleUse(["nobody:writing-style-x", "--json"], {}, fakeDeps())).rejects.toThrow("exit 2");
    const e = JSON.parse(out[0]!).error;
    expect(e.code).toBe("unknown-skill");
    expect(e.message).toContain("mattstack:writing-style-sparse");
    expect(writes).toEqual([]);
  });

  test("a bad id is refused before the home-repo check or any lookup", async () => {
    let listed = false;
    await expect(writingStyleUse(["-rf", "--json"], {}, fakeDeps({ pluginListStdout: async () => { listed = true; return "[]"; } }))).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("bad-id");
    expect(listed).toBe(false);
  });

  test("a personal skill is linked, then accepted", async () => {
    homeRepo();
    const dir = join(home, ".mattstack", "user", "skills", "my-voice");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: my-voice\ndescription: x\n---\nbody\n");
    await writingStyleUse(["my-voice", "--json"], {}, fakeDeps());
    expect(lstatSync(join(home, ".claude", "skills", "my-voice")).isSymbolicLink()).toBe(true);
    expect(writes[0]!.value).toBe("my-voice");
  });

  test("no id without a TTY is usage; with a TTY it picks", async () => {
    homeRepo();
    await expect(writingStyleUse(["--json"], {}, fakeDeps())).rejects.toThrow("exit 2");
    expect(JSON.parse(out[0]!).error.code).toBe("usage");
    out.length = 0;
    await writingStyleUse([], {}, fakeDeps({ isTTY: () => true, pick: async () => "mattstack:writing-style-conversational" }));
    expect(writes[0]!.value).toBe("mattstack:writing-style-conversational");
  });
});
```

`-rf` must reach the id check: `use` takes the first arg that is not `--json`, `--scope` or `--scope`'s value as the id, even when it starts with `-`, so the app's "own skill" text is always validated rather than parsed as a flag.

- [ ] **Step 2: Run to see it fail**

Run: `bun test commands/__tests__/skills-writing-style.test.ts`
Expected: FAIL, `writingStyleUse` not exported.

- [ ] **Step 3: Implement**

Append to `commands/skills-writing-style.ts`:

```ts
function parseUseArgs(args: string[]): { id: string | undefined; scope: string; json: boolean } {
  let scope = "user";
  let id: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") json = true;
    else if (a === "--scope") scope = args[++i] ?? "";
    else if (a.startsWith("--scope=")) scope = a.slice("--scope=".length);
    else if (id === undefined) id = a;
  }
  return { id, scope, json };
}

export async function writingStyleUse(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const { id: given, scope, json } = parseUseArgs(args);
  if (given !== undefined && !isValidSkillId(given)) return refuse(new UserActionableError("bad-id", `"${given}" is not a skill id`), json, "use", deps);
  if (scope !== "user" && scope !== "team") return refuse(new UserActionableError("usage", `--scope must be user or team, not "${scope}"`), json, "use", deps);
  // setSetting creates the store directory, and a write inside ~/.mattstack/user before home.init or home.restore clones makes that clone fail.
  if (!existsSync(homeGitDir(deps.home()))) {
    return refuse(new UserActionableError("no-home-repo", "your home repo does not exist yet; finish rt setup first"), json, "use", deps);
  }

  const { linkPersonalSkills, isStyleUsable } = await import("../lib/skills/writing-style-sources.ts");
  linkPersonalSkills(deps.home());
  const inv = await inventory(deps);
  const listing = listWritingStyles(inv, deps.resolve());

  let id = given;
  if (id === undefined) {
    if (deps.isTTY() && !json && !process.env.RT_BATCH) {
      id = (await deps.pick("Which writing style?", listing.options.map((o) => ({ value: o.id, label: o.label, hint: o.detail })))) ?? undefined;
      if (!id) return deps.exit(0);
    } else {
      return refuse(new UserActionableError("usage", "usage: rt skills writing-style use <skill-id> [--scope user|team] [--json]"), json, "use", deps);
    }
  }

  if (!isValidSkillId(id)) return refuse(new UserActionableError("bad-id", `"${id}" is not a skill id`), json, "use", deps);
  if (!isStyleUsable(id, inv)) {
    const choices = listing.options.filter((o) => o.kind === "preset" || o.installed).map((o) => o.id).join(", ");
    return refuse(new UserActionableError("unknown-skill", `${id} is not installed here. Choose one of: ${choices}`), json, "use", deps);
  }

  deps.writeSetting(WRITING_STYLE_KEY, id, scope);
  deps.print(json ? JSON.stringify(envelope({ skill: id, scope }, deps.now())) : `writing style: ${id} (${scope})`);
}
```

Add `isValidSkillId`, `WRITING_STYLE_KEY` to the `writing-style.ts` import and `listWritingStyles` is already imported. Prefer a static import of `linkPersonalSkills`/`isStyleUsable` alongside the others if the no-eager-tui test allows it (it gates only UI modules); use the static import and drop the dynamic one if it passes.

In `lib/command-tree-def.ts`, add under `writing-style.subcommands`:

```ts
          use: {
            description: "Choose the writing style for prose posted under your name",
            module: "./commands/skills-writing-style.ts",
            fn: "writingStyleUse",
            omitBehavior: "picker",
            args: [
              { name: "Skill", type: "text", placeholder: "mattstack:writing-style-sparse", hint: "A preset or any installed skill id; omit to pick" },
              { name: "Scope", flag: "--scope", type: "select", options: [{ value: "user", label: "user" }, { value: "team", label: "team" }], default: "user", hint: "user (just you) or team (the team default)" },
              SETUP_JSON_ARG,
            ],
          },
```

- [ ] **Step 4: Run tests**

Run: `bun test commands/__tests__/skills-writing-style.test.ts lib/__tests__/picker-conformance.test.ts && bun run picker:check && bun run docs:gen && bun run docs:check`
Expected: PASS; `0 violation(s)`; docs check passes.

- [ ] **Step 5: Commit**

```bash
git add commands/skills-writing-style.ts commands/__tests__/skills-writing-style.test.ts lib/command-tree-def.ts website/docs/reference
git commit -m "skills writing-style: use, guarded by the home repo"
```

---

### Task 6: `new`

**Files:**
- Modify: `commands/skills-writing-style.ts`, `lib/command-tree-def.ts`
- Test: `commands/__tests__/skills-writing-style.test.ts`

- [ ] **Step 1: Write the failing tests**

Append (import `writingStyleNew`, `readFileSync`, `writeFileSync`, `lstatSync`):

```ts
describe("new", () => {
  const homeRepo = () => mkdirSync(join(home, ".mattstack", "user", ".git"), { recursive: true });
  function mattstackPlugin(): string {
    const installPath = join(home, "cache", "mattstack");
    const dir = join(installPath, "skills", "writing-style-sparse");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), [
      "---",
      "name: writing-style-sparse",
      'description: "Use only when the mattstack writing-style lookup names mattstack:writing-style-sparse. Terse."',
      "---",
      "",
      "<!-- compiled by rt skills compile from the sources below; slots pre-resolved; edits here are working-tree drift (rt skills promote) -->",
      "<!-- part: step source=mattstack:writing-style-sparse version=0.18.0 path=x lines=1-9 -->",
      "# Sparse",
      "",
    ].join("\n"));
    writeFileSync(join(dir, "pr-description.md"), "# PR descriptions (sparse)\n");
    return JSON.stringify([{ id: "mattstack@mattstack", enabled: true, installPath }]);
  }

  test("copies the preset into the home repo, strips compiler comments, renames, links", async () => {
    homeRepo();
    const list = mattstackPlugin();
    await writingStyleNew(["my-voice", "--from", "sparse", "--json"], {}, fakeDeps({ pluginListStdout: async () => list }));
    const dir = join(home, ".mattstack", "user", "skills", "my-voice");
    const text = readFileSync(join(dir, "SKILL.md"), "utf8");
    expect(text).toContain("name: my-voice");
    expect(text).toContain("names my-voice.");
    expect(text).not.toContain("<!-- ");
    expect(readFileSync(join(dir, "pr-description.md"), "utf8")).toContain("PR descriptions");
    expect(lstatSync(join(home, ".claude", "skills", "my-voice")).isSymbolicLink()).toBe(true);
    const body = JSON.parse(out[0]!);
    expect(body).toMatchObject({ name: "my-voice", from: "mattstack:writing-style-sparse" });
  });

  test("refusals: no-home-repo, bad-name, bad-preset, exists, no-plugin, usage", async () => {
    const code = async (args: string[], over: Partial<WritingStyleDeps> = {}) => {
      out.length = 0;
      await expect(writingStyleNew([...args, "--json"], {}, fakeDeps(over))).rejects.toThrow("exit 2");
      return JSON.parse(out[0]!).error.code;
    };
    expect(await code(["my-voice"])).toBe("no-home-repo");
    homeRepo();
    expect(await code(["../x"])).toBe("bad-name");
    expect(await code(["my-voice", "--from", "loud"])).toBe("bad-preset");
    expect(await code(["my-voice"], { pluginListStdout: async () => "[]" })).toBe("no-plugin");
    const list = mattstackPlugin();
    mkdirSync(join(home, ".mattstack", "user", "skills", "taken"), { recursive: true });
    expect(await code(["taken"], { pluginListStdout: async () => list })).toBe("exists");
    expect(await code([])).toBe("usage");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun test commands/__tests__/skills-writing-style.test.ts`
Expected: FAIL, `writingStyleNew` not exported.

- [ ] **Step 3: Implement**

Append to `commands/skills-writing-style.ts` (add `mkdirSync`, `readFileSync`, `writeFileSync` to the `fs` import and `join` from `path`):

```ts
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const PRESET_SHORT = ["sparse", "conversational", "structured"] as const;

function stripCompilerComments(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("<!-- compiled by rt skills compile") && !l.trim().startsWith("<!-- part: "))
    .join("\n");
}

/** Renames the frontmatter `name` and the preset id the description gates on, so the copy is a skill of its own. */
function retarget(text: string, presetId: string, name: string): string {
  const end = text.indexOf("\n---", 4);
  if (!text.startsWith("---\n") || end === -1) return text;
  const frontmatter = text
    .slice(0, end)
    .replace(/^name:.*$/m, `name: ${name}`)
    .split(presetId)
    .join(name);
  return frontmatter + text.slice(end);
}

export async function writingStyleNew(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const json = args.includes("--json");
  let from = "conversational";
  let name: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") continue;
    if (a === "--from") from = args[++i] ?? "";
    else if (a.startsWith("--from=")) from = a.slice("--from=".length);
    else if (name === undefined) name = a;
  }

  if (!existsSync(homeGitDir(deps.home()))) {
    return refuse(new UserActionableError("no-home-repo", "your home repo does not exist yet; finish rt setup first"), json, "new", deps);
  }
  if (name === undefined) {
    if (deps.isTTY() && !json && !process.env.RT_BATCH) name = (await deps.prompt("Name for your writing style (lowercase, e.g. my-voice)")) ?? undefined;
    if (name === undefined) return refuse(new UserActionableError("usage", "usage: rt skills writing-style new <name> [--from sparse|conversational|structured] [--json]"), json, "new", deps);
  }
  if (!NAME_RE.test(name)) return refuse(new UserActionableError("bad-name", `"${name}" must be lowercase letters, digits, dot, dash or underscore`), json, "new", deps);

  const presetId = (PRESET_SHORT as readonly string[]).includes(from) ? `mattstack:writing-style-${from}` : from;
  if (!presetById(presetId)) return refuse(new UserActionableError("bad-preset", `--from must be one of ${PRESET_SHORT.join(", ")}`), json, "new", deps);

  const target = join(personalSkillsDir(deps.home()), name);
  if (existsSync(target)) return refuse(new UserActionableError("exists", `${target} already exists`), json, "new", deps);

  const stdout = await deps.pluginListStdout();
  const mattstack = (stdout === null ? null : parsePluginEntries(stdout))?.find((p) => p.id.startsWith("mattstack@") && p.installPath);
  const source = mattstack?.installPath ? join(mattstack.installPath, "skills", presetId.split(":")[1]!) : null;
  if (!source || !existsSync(join(source, "SKILL.md"))) {
    return refuse(new UserActionableError("no-plugin", "the mattstack plugin with the writing-style presets is not installed; run rt setup"), json, "new", deps);
  }

  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "SKILL.md"), retarget(stripCompilerComments(readFileSync(join(source, "SKILL.md"), "utf8")), presetId, name));
  if (existsSync(join(source, "pr-description.md"))) writeFileSync(join(target, "pr-description.md"), readFileSync(join(source, "pr-description.md"), "utf8"));
  linkPersonalSkills(deps.home());

  deps.print(json
    ? JSON.stringify(envelope({ name, path: target, from: presetId }, deps.now()))
    : `created ${target} from ${presetId}\nedit it, then: rt skills writing-style use ${name}`);
}
```

Import `personalSkillsDir`, `linkPersonalSkills` statically from `writing-style-sources.ts`.

In `lib/command-tree-def.ts`, add under `writing-style.subcommands`:

```ts
          new: {
            description: "Start your own writing style from a preset, in your home repo",
            module: "./commands/skills-writing-style.ts",
            fn: "writingStyleNew",
            omitBehavior: "prompt",
            args: [
              { name: "Name", type: "text", placeholder: "my-voice", hint: "Lowercase name for the new skill" },
              { name: "From", flag: "--from", type: "select", options: [{ value: "sparse", label: "sparse" }, { value: "conversational", label: "conversational" }, { value: "structured", label: "structured" }], default: "conversational", hint: "Preset to start from" },
              SETUP_JSON_ARG,
            ],
          },
```

- [ ] **Step 4: Run tests**

Run: `bun test commands/__tests__/skills-writing-style.test.ts && bun run picker:check && bun run docs:gen && bun run docs:check`
Expected: PASS; `0 violation(s)`; docs check passes.

- [ ] **Step 5: Commit**

```bash
git add commands/skills-writing-style.ts commands/__tests__/skills-writing-style.test.ts lib/command-tree-def.ts website/docs/reference
git commit -m "skills writing-style: new scaffolds a personal style from a preset"
```

---

### Task 7: The `choose` action and non-waivable finish gates (contract)

**Files:**
- Modify: `lib/setup/contract.ts`, `lib/setup/finish-gate.ts`, `commands/setup.ts` (`runWaiver` candidates)
- Test: `lib/setup/__tests__/finish-gate.test.ts`, `lib/setup/__tests__/contract.test.ts`

**Interfaces:**
- Produces:
  - `interface ChooseOption { id: string; label: string; detail: string; sample?: string }`
  - Action variant `{ type: "choose"; label: string; verb: string[]; options: ChooseOption[]; selected?: string; other?: { label: string; hint: string } }`
  - `Row.waivable?: boolean`
  - `WAIVABLE_ROW_IDS: readonly string[] = ["tool.fast-browser-extension"]`
  - `DONE_ACTION_TYPES = ["open-url", "steps", "run", "choose"] as const` (parity with the app's Done screen)
  - `FINISH_GATED_ROW_IDS` is NOT changed here; Task 8 adds the row id together with the row, since `validators-tools.test.ts` asserts the finish-gated tool rows equal that list.

- [ ] **Step 1: Write the failing tests**

Append to `lib/setup/__tests__/finish-gate.test.ts` (import `applyFinishGate` from `../finish-gate.ts`, `finishBlockers`, `row`, `FINISH_GATED_ROW_IDS`, `WAIVABLE_ROW_IDS` from `../contract.ts`):

```ts
describe("non-waivable finish gates", () => {
  const style = row({ id: "skills.writing-style", kind: "tool", title: "Writing style", why: "x", required: false, status: "needs-you", detail: "d", finishGated: true });
  const ext = row({ id: "tool.fast-browser-extension", kind: "tool", title: "Ext", why: "x", required: false, status: "needs-you", detail: "d", finishGated: true });
  const groups = [{ id: "tools" as const, title: "Tools", rows: [style, ext] }];

  test("only the Fast Browser row is waivable", () => {
    expect(WAIVABLE_ROW_IDS).toEqual(["tool.fast-browser-extension"]);
  });

  test("a stored waiver for a non-waivable row is ignored where the gate is read", () => {
    const waived = ["skills.writing-style", "tool.fast-browser-extension"];
    expect(finishBlockers(groups, waived)).toEqual(["skills.writing-style"]);
    const applied = applyFinishGate(groups, "status", waived)[0]!.rows;
    expect(applied.find((r) => r.id === "skills.writing-style")?.waived).toBeFalsy();
    expect(applied.find((r) => r.id === "tool.fast-browser-extension")?.waived).toBe(true);
  });

  test("every finish-gated row carries waivable", () => {
    const applied = applyFinishGate(groups, "plan", [])[0]!.rows;
    expect(applied.map((r) => [r.id, r.waivable])).toEqual([["skills.writing-style", false], ["tool.fast-browser-extension", true]]);
  });

  test("waive refuses a finish-gated row that is not waivable", () => {
    const store = { ids: [] as string[], read() { return this.ids; }, write(ids: string[]) { this.ids = ids; } };
    expect(() => waiveRow("skills.writing-style", store)).toThrow(UserActionableError);
    expect(store.ids).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `bun test lib/setup/__tests__/finish-gate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/setup/contract.ts`:

```ts
export interface ChooseOption {
  id: string;
  label: string;
  detail: string;
  sample?: string;
}
```

Add to the `Action` union:

```ts
  // The app appends the picked id and --json to verb; "other" collects a free-text id for the same verb.
  | { type: "choose"; label: string; verb: string[]; options: ChooseOption[]; selected?: string; other?: { label: string; hint: string } }
```

Add to `Row`:

```ts
  /** Emitted on every finish-gated row: whether Skip for now is offered. An app reading a row without it treats a finish-gated row as waivable. */
  waivable?: boolean;
```

Add beside `FINISH_GATED_ROW_IDS` (leave that list unchanged in this task):

```ts
/** The finish-gated rows `rt setup waive` may skip; the gate honors a stored waiver only for these. */
export const WAIVABLE_ROW_IDS: readonly string[] = ["tool.fast-browser-extension"];

/** Action types the app's Done screen can act on; a finish-gated row must only carry these (parity with DoneActions in rt-tray). */
export const DONE_ACTION_TYPES = ["open-url", "steps", "run", "choose"] as const;
```

In `finishBlockers`, honor only waivable ids:

```ts
export function finishBlockers(groups: Group[], waived: readonly string[] = []): string[] {
  const honored = waived.filter((id) => WAIVABLE_ROW_IDS.includes(id));
  return groups.flatMap((g) =>
    g.rows.filter((r) => r.finishGated === true && r.status !== "ready" && r.status !== "skipped" && !honored.includes(r.id)).map((r) => r.id),
  );
}
```

`lib/setup/finish-gate.ts`:

```ts
export function applyFinishGate(groups: Group[], mode: "plan" | "status", waived: readonly string[] = []): Group[] {
  const honored = waived.filter((id) => WAIVABLE_ROW_IDS.includes(id));
  return groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => {
      if (!r.finishGated) return r;
      const gated = { ...r, waivable: WAIVABLE_ROW_IDS.includes(r.id) };
      if (honored.includes(r.id)) return { ...gated, required: false, waived: true, optionalNote: WAIVED_NOTE };
      if (mode === "status" && r.status !== "skipped") return { ...gated, required: true, optionalNote: null };
      return gated;
    }),
  }));
}
```

`waiveRow` refuses a non-waivable id; `unwaiveRow` keeps `assertFinishGated`:

```ts
function assertWaivable(id: string): void {
  if (WAIVABLE_ROW_IDS.includes(id)) return;
  throw new UserActionableError("not-waivable", `${id} cannot be skipped; waivable rows: ${WAIVABLE_ROW_IDS.join(", ")}`);
}
```

Call `assertWaivable(id)` at the top of `waiveRow` in place of `assertFinishGated(id)`. Import `WAIVABLE_ROW_IDS`.

In `commands/setup.ts` `runWaiver`, change the waive candidates to `[...WAIVABLE_ROW_IDS]` and import it.

In `lib/setup/__tests__/contract.test.ts`, add:

```ts
test("DONE_ACTION_TYPES matches the app's DoneActions.handled", () => {
  expect([...DONE_ACTION_TYPES]).toEqual(["open-url", "steps", "run", "choose"]);
});
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/setup commands/__tests__/setup*.test.ts`
Expected: PASS after one deliberate update: `commands/__tests__/setup-waive.test.ts` (around line 80) expects `not-finish-gated` for an id `waive` now refuses with `not-waivable` (waive checks the waivable list first); change that expectation. `unwaive` keeps `not-finish-gated`. Do not edit any other existing assertion to make it pass.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/contract.ts lib/setup/finish-gate.ts commands/setup.ts lib/setup/__tests__
git commit -m "setup contract: choose action, waivable rows, non-waivable finish gates"
```

---

### Task 8: The setup row

**Files:**
- Create: `lib/setup/validators/writing-style.ts`
- Modify: `lib/setup/validators/tools.ts` (push the row after `pluginsRow`)
- Test: `lib/setup/__tests__/validators-writing-style.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 7.
- Produces: `WRITING_STYLE_ROW_ID`, `writingStyleRow(input)`, `writingStyleRowFor(p, pluginList): Row`.

- [ ] **Step 1: Write the failing tests**

`lib/setup/__tests__/validators-writing-style.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { DONE_ACTION_TYPES, FINISH_GATED_ROW_IDS, WAIVABLE_ROW_IDS, finishBlockers } from "../contract.ts";
import { unwaiveRow } from "../finish-gate.ts";
import { writingStyleRow, writingStyleRowFor } from "../validators/writing-style.ts";
import type { SkillInventory } from "../../skills/writing-style-sources.ts";

const inv = (installed: string[] = [], disabled: [string, string][] = []): SkillInventory => ({
  installed: new Set(installed), disabledPluginFor: new Map(disabled), personal: [],
});
const opts = [{ id: "mattstack:writing-style-sparse", label: "Sparse", detail: "d", sample: "s", kind: "preset" as const, installed: false }];

describe("writingStyleRow", () => {
  test("before Install: needs-you, no action", () => {
    const r = writingStyleRow({ homeReady: false, resolved: { skill: "x", source: "fallback" }, inventory: inv(), options: opts });
    expect(r.status).toBe("needs-you");
    expect(r.action).toBeNull();
    expect(r.detail).toBe("You'll choose this after Install");
    expect(r.finishGated).toBe(true);
    expect(r.kind).toBe("tool");
  });

  test("after Install with nothing chosen: needs-you with the choose action", () => {
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "mattstack:writing-style-conversational", source: "fallback" }, inventory: inv(), options: opts });
    expect(r.status).toBe("needs-you");
    expect(r.action).toMatchObject({ type: "choose", verb: ["skills", "writing-style", "use"] });
    expect((r.action as { options: unknown[] }).options).toHaveLength(1);
    expect((r.action as { other?: { label: string } }).other?.label).toBe("Use my own skill…");
  });

  test("a team default naming a preset is ready on a fresh Mac", () => {
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "mattstack:writing-style-sparse", source: "team" }, inventory: inv(), options: opts });
    expect(r.status).toBe("ready");
    expect(r.detail).toBe("Sparse (team default)");
  });

  test("a configured skill that is not installed is invalid; a disabled plugin is named", () => {
    expect(writingStyleRow({ homeReady: true, resolved: { skill: "x:writing-style-a", source: "user" }, inventory: inv(), options: opts }).status).toBe("invalid");
    const d = writingStyleRow({ homeReady: true, resolved: { skill: "x:y", source: "user" }, inventory: inv([], [["x:y", "x@m"]]), options: opts });
    expect(d.detail).toContain("enable x@m");
  });

  test("preferences.md and personal choices read ready with their source", () => {
    expect(writingStyleRow({ homeReady: true, resolved: { skill: "matt:matts-writing-style", source: "preferences" }, inventory: inv(["matt:matts-writing-style"]), options: opts }).detail).toBe("matt:matts-writing-style (from preferences.md)");
    expect(writingStyleRow({ homeReady: true, resolved: { skill: "my-voice", source: "user" }, inventory: inv(["my-voice"]), options: opts }).detail).toBe("my-voice (yours)");
  });

  test("every action this row can carry is one the Done screen handles", () => {
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "x", source: "fallback" }, inventory: inv(), options: opts });
    expect((DONE_ACTION_TYPES as readonly string[]).includes(r.action!.type)).toBe(true);
  });

  test("a ready row preselects the current style in its choose action", () => {
    const r = writingStyleRow({ homeReady: true, resolved: { skill: "mattstack:writing-style-sparse", source: "user" }, inventory: inv(), options: opts });
    expect((r.action as { selected?: string }).selected).toBe("mattstack:writing-style-sparse");
  });
});

describe("writing-style row in the finish gate", () => {
  test("the row id is finish-gated and not waivable; unwaive still clears a stale entry", () => {
    expect(FINISH_GATED_ROW_IDS).toContain("skills.writing-style");
    expect(WAIVABLE_ROW_IDS).not.toContain("skills.writing-style");
    const store = { ids: ["skills.writing-style"], read() { return this.ids; }, write(ids: string[]) { this.ids = ids; } };
    expect(unwaiveRow("skills.writing-style", store)).toEqual({ waived: [], changed: true });
  });

  test("an error row never blocks Finish: a gate that could not be evaluated must not strand the wizard", () => {
    const broken = writingStyleRowFor(
      { home: "/nonexistent-home", exists: () => { throw new Error("store unreadable"); } },
      { code: 0, stdout: "[]", stderr: "" },
    );
    expect(broken.status).toBe("error");
    expect(broken.finishGated).toBe(false);
    expect(finishBlockers([{ id: "tools", title: "Tools", rows: [broken] }])).toEqual([]);
  });
});
```

Add the matching guard for the other finish-gated row in `validators-tools.test.ts`: the fast-browser extension row's action type is in `DONE_ACTION_TYPES` in each state that carries one.

- [ ] **Step 2: Run to see it fail**

Run: `bun test lib/setup/__tests__/validators-writing-style.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

`lib/setup/validators/writing-style.ts`:

```ts
import { row, type Action, type Row } from "../contract.ts";
import type { ExecResult, Probes } from "../probes.ts";
import { homeGitDir } from "../steps/home.ts";
import { presetById, resolveWritingStyle, type ResolvedWritingStyle } from "../../skills/writing-style.ts";
import {
  isStyleUsable, listWritingStyles, parsePluginEntries, readSkillInventory, type SkillInventory, type WritingStyleOption,
} from "../../skills/writing-style-sources.ts";

export const WRITING_STYLE_ROW_ID = "skills.writing-style";

const BASE = {
  id: WRITING_STYLE_ROW_ID,
  kind: "tool" as const,
  title: "Writing style",
  why: "How the reviews, replies and PR descriptions agents post under your name read. Without one they read like an AI assistant.",
  required: false,
  finishGated: true,
  recheck: "on-change" as const,
};

const SOURCE_LABEL: Record<Exclude<ResolvedWritingStyle["source"], "fallback">, string> = {
  user: "yours",
  team: "team default",
  preferences: "from preferences.md",
};

function chooseAction(options: WritingStyleOption[], selected?: string): Action {
  return {
    type: "choose",
    label: "Choose style…",
    verb: ["skills", "writing-style", "use"],
    options: options.map(({ id, label, detail, sample }) => ({ id, label, detail, ...(sample ? { sample } : {}) })),
    ...(selected ? { selected } : {}),
    other: { label: "Use my own skill…", hint: "Any installed skill id. Start one with rt skills writing-style new." },
  };
}

export function writingStyleRow(input: { homeReady: boolean; resolved: ResolvedWritingStyle; inventory: SkillInventory; options: WritingStyleOption[] }): Row {
  const { homeReady, resolved, inventory, options } = input;
  // use writes the user store inside the home repo, which does not exist until Install clones it.
  if (!homeReady) return row({ ...BASE, status: "needs-you", detail: "You'll choose this after Install" });

  const action = chooseAction(options, resolved.source === "fallback" ? undefined : resolved.skill);
  if (resolved.source === "fallback") {
    return row({ ...BASE, status: "needs-you", detail: "Choose how your reviews and replies read (or run rt skills writing-style use)", action });
  }
  if (!isStyleUsable(resolved.skill, inventory)) {
    const plugin = inventory.disabledPluginFor.get(resolved.skill);
    return row({ ...BASE, status: "invalid", detail: plugin ? `${resolved.skill} is in a disabled plugin: enable ${plugin}` : `${resolved.skill} is not installed here`, action });
  }
  const label = presetById(resolved.skill)?.label ?? resolved.skill;
  return row({ ...BASE, status: "ready", detail: `${label} (${SOURCE_LABEL[resolved.source]})`, action });
}

/**
 * A throw here would reach buildGroup's catch and replace every tools row, so
 * the row reports its own error. The error row is not finish-gated: it cannot
 * be waived and carries no action, so gating on it would strand Finish.
 */
export function writingStyleRowFor(p: Pick<Probes, "home" | "exists">, pluginList: ExecResult): Row {
  try {
    const inventory = readSkillInventory(p.home, pluginList.code === 0 ? parsePluginEntries(pluginList.stdout) : null);
    const resolved = resolveWritingStyle({ home: p.home });
    return writingStyleRow({ homeReady: p.exists(homeGitDir(p.home)), resolved, inventory, options: listWritingStyles(inventory, resolved).options });
  } catch (err) {
    return row({ ...BASE, finishGated: false, status: "error", detail: `could not read the writing style: ${err instanceof Error ? err.message : String(err)}` });
  }
}
```

In `lib/setup/validators/tools.ts`, right after `rows.push(pluginsRow(pluginList));`:

```ts
  rows.push(writingStyleRowFor(p, pluginList));
```

with `import { writingStyleRowFor } from "./writing-style.ts";`.

In `lib/setup/contract.ts`, add the row id to the finish gate now that the row exists:

```ts
export const FINISH_GATED_ROW_IDS: readonly string[] = ["tool.fast-browser-extension", "skills.writing-style"];
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/setup commands/__tests__/setup*.test.ts`
Expected: PASS after these deliberate updates. The rule: any assertion on a
plan built by `composePlan` over the real tools group, whether on
`finishBlockedBy` or on the tools row list, gains `skills.writing-style`,
because the fake probes' home (`/fake-home`) has no home repo, so the row
reads `needs-you` before Install and blocks Finish. Known sites:
- `validators-tools.test.ts` (around line 465): the finish-gated tool rows now equal both ids, matching `FINISH_GATED_ROW_IDS`.
- `plan.test.ts` (around line 280, "exactly one finish-gated row today"): now two.
- `plan.test.ts` (around line 230): `finishBlockedBy` becomes `["tool.fast-browser-extension", "skills.writing-style"]`.
- `plan.test.ts` (around line 349): after waiving the extension, `finishBlockedBy` becomes `["skills.writing-style"]`, which also shows a waiver cannot clear this row.
- Tests that assert the exact tools row list gain `skills.writing-style` right after `tool.plugins`.

Do not weaken or delete any other assertion to get green; a failure outside
this rule is a real finding to report.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/validators/writing-style.ts lib/setup/validators/tools.ts lib/setup/contract.ts lib/setup/__tests__
git commit -m "setup: writing-style row (finish-gated, not waivable, choose action)"
```

---

### Task 9: App core: models, dispatch, choice client

**Files:**
- Modify: `rt-tray/Sources-core/Contract/PlanModels.swift`, `rt-tray/Sources-core/Readiness/RowActionDispatcher.swift`, `rt-tray/Sources-core/Setup/FinishGate.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/PlanModelsChecks.swift`, `RowActionChecks.swift`, `DoneModelChecks.swift`

**Interfaces:**
- Produces (Swift, `MattstackCore`):
  - `ActionType.choose` (and `ActionType: CaseIterable`); `ChooseOption { id, label, detail, sample? }`; `ChooseOther { label, hint }`; `RowAction.options: [ChooseOption]?`, `RowAction.selected: String?`, `RowAction.other: ChooseOther?`
  - `PlanRow.waivable: Bool` (absent decodes as `finishGated`)
  - `DispatchedAction.chooseOption(options: [ChooseOption], other: ChooseOther?)`
  - `ChoiceClient(rt:)` with `func choose(verb: [String], id: String) async -> String?` (nil on success, else failure copy)
  - `DoneRoute` (`.openURL(URL)`, `.steps([String])`, `.recheck`, `.choose`) and `DoneActions.route(_ action: RowAction) -> DoneRoute?`, the Done screen's only routing (Task 10's `DoneScreen.show` switches on it), so the parity check tests what Done actually does

- [ ] **Step 1: Write the failing checks**

Append to `planModelsChecks` in `PlanModelsChecks.swift`:

```swift
    Check("choose action decodes options and other; unknown type still decodes") { c in
        let json = """
        {"type":"choose","label":"Choose style…","verb":["skills","writing-style","use"],
         "options":[{"id":"mattstack:writing-style-sparse","label":"Sparse","detail":"Terse.","sample":"**issue:** x"}],
         "selected":"mattstack:writing-style-sparse",
         "other":{"label":"Use my own skill…","hint":"Any installed skill id."}}
        """
        let a = try JSONDecoder().decode(RowAction.self, from: Data(json.utf8))
        c.expectEqual(a.type, .choose)
        c.expectEqual(a.selected, "mattstack:writing-style-sparse")
        c.expectEqual(a.options?.first?.id, "mattstack:writing-style-sparse")
        c.expectEqual(a.options?.first?.sample, "**issue:** x")
        c.expectEqual(a.other?.label, "Use my own skill…")
        let u = try JSONDecoder().decode(RowAction.self, from: Data(#"{"type":"future-thing","label":"?"}"#.utf8))
        c.expectEqual(u.type, .unknown)
    },
    Check("waivable: absent on a finish-gated row reads true; present is honored") { c in
        func row(_ extra: String) -> String {
            #"{"id":"r","kind":"tool","title":"t","why":"w","required":false,"status":"needs-you","recheck":"on-change""# + extra + "}"
        }
        c.expectEqual(try JSONDecoder().decode(PlanRow.self, from: Data(row(#","finishGated":true"#).utf8)).waivable, true)
        c.expectEqual(try JSONDecoder().decode(PlanRow.self, from: Data(row(#","finishGated":true,"waivable":false"#).utf8)).waivable, false)
        c.expectEqual(try JSONDecoder().decode(PlanRow.self, from: Data(row("").utf8)).waivable, false)
    },
```

Append to `rowActionChecks` in `RowActionChecks.swift`:

```swift
    Check("choose: sheet first, then the verb with the picked id and --json") { c in
        let opts = [ChooseOption(id: "mattstack:writing-style-sparse", label: "Sparse", detail: "Terse.")]
        let a = RowAction(type: .choose, label: "Choose style…", verb: ["skills", "writing-style", "use"], options: opts, other: ChooseOther(label: "Use my own skill…", hint: "h"))
        c.expectEqual(RowActionDispatcher.dispatch(a, fieldValues: nil, alternative: nil), .chooseOption(options: opts, other: ChooseOther(label: "Use my own skill…", hint: "h")))
        c.expectEqual(RowActionDispatcher.dispatch(a, fieldValues: ["id": "my-voice"], alternative: nil),
                      .rtVerb(args: ["skills", "writing-style", "use", "my-voice", "--json"], stdin: nil))
        c.expectEqual(RowActionDispatcher.dispatch(RowAction(type: .choose, label: "x"), fieldValues: ["id": "a"], alternative: nil), .none)
    },
```

Append to `doneModelChecks` in `DoneModelChecks.swift`:

```swift
    Check("Done routes exactly the contract's DONE_ACTION_TYPES (lib/setup/contract.ts)") { c in
        let sample = { (t: ActionType) in RowAction(type: t, label: "x", verb: ["a"], steps: ["s"], url: "https://example.com") }
        let routed = Set(ActionType.allCases.filter { DoneActions.route(sample($0)) != nil })
        c.expectEqual(routed, Set([ActionType.openURL, .steps, .run, .choose]))
    },
    Check("ChoiceClient: nil on success; the exit-2 envelope's message on refusal") { c in
        let rt = ScriptedRt()
        rt.answers["skills writing-style use a"] = (0, #"{"contract":1,"at":"x","skill":"a","scope":"user"}"#)
        rt.answers["skills writing-style use -rf"] = (2, #"{"contract":1,"at":"x","error":{"code":"bad-id","message":"\"-rf\" is not a skill id"}}"#)
        let client = await ChoiceClient(rt: rt)
        c.expect(await client.choose(verb: ["skills", "writing-style", "use"], id: "a") == nil)
        c.expectEqual(await client.choose(verb: ["skills", "writing-style", "use"], id: "-rf"), "\"-rf\" is not a skill id")
        c.expectEqual(rt.calls.last?.args, ["skills", "writing-style", "use", "-rf", "--json"])
    },
```

`ScriptedRt` answers by the longest key that prefixes the joined args (`ScriptedRt.swift`), and the harness has `expect` and `expectEqual` only (no `expectNil`). Checks may be async (`Harness.swift`: the body is `async throws`). `ChoiceClient` is `@MainActor`; if the harness does not run checks on the main actor, construct and call it inside `await MainActor.run { ... }`.

- [ ] **Step 2: Run to see them fail**

Run: `cd rt-tray && swift build && swift run mattstack-checks choose`
Expected: build errors for the missing symbols.

- [ ] **Step 3: Implement**

`PlanModels.swift`: add `case choose` to `ActionType` and make it `CaseIterable` (its custom `init(from:)` is unaffected). Add:

```swift
public struct ChooseOption: Codable, Equatable, Sendable {
    public var id: String
    public var label: String
    public var detail: String
    public var sample: String?
    public init(id: String, label: String, detail: String, sample: String? = nil) {
        self.id = id; self.label = label; self.detail = detail; self.sample = sample
    }
}

public struct ChooseOther: Codable, Equatable, Sendable {
    public var label: String
    public var hint: String
    public init(label: String, hint: String) { self.label = label; self.hint = hint }
}
```

Add `options: [ChooseOption]?`, `selected: String?` and `other: ChooseOther?` to `RowAction` (properties, init parameters defaulting to `nil`, assignments).

Add to `PlanRow`: `public var waivable: Bool`, an init parameter `waivable: Bool? = nil` assigned as `waivable ?? finishGated`, and in `init(from:)` after `finishGated`:

```swift
        // An rt that predates `waivable` offered Skip on every finish-gated row.
        waivable = try c.decodeIfPresent(Bool.self, forKey: .waivable) ?? finishGated
```

`RowActionDispatcher.swift`: add `case chooseOption(options: [ChooseOption], other: ChooseOther?)` to `DispatchedAction`, and in `dispatch`:

```swift
        case .choose:
            guard let verb = action.verb, !verb.isEmpty else { return .none }
            if let id = fieldValues?["id"] { return .rtVerb(args: verb + [id, "--json"], stdin: nil) }
            return .chooseOption(options: action.options ?? [], other: action.other)
```

`FinishGate.swift`, beside `WaiverClient`:

```swift
/// Runs a choose row's verb for the Done screen and Settings, which have no
/// verb runner of their own, so a refusal can be shown inside the sheet.
@MainActor
public final class ChoiceClient {
    private let rt: RtRunning
    public init(rt: RtRunning) { self.rt = rt }

    /// nil once the verb succeeded; otherwise the user-facing failure copy.
    public func choose(verb: [String], id: String) async -> String? {
        let args = verb + [id, "--json"]
        do {
            let result = try await rt.run(args, stdin: nil)
            if let e = result.userError { return e.message }
            if result.exitCode != 0 { return result.failureCopy(verb: args.dropLast().joined(separator: " ")) }
        } catch {
            return (error as? RtClientError)?.copy ?? "rt \(verb.joined(separator: " ")) failed to start."
        }
        return nil
    }
}

public enum DoneRoute: Equatable, Sendable {
    case openURL(URL)
    case steps([String])
    case recheck
    case choose
}

/// The Done screen's only routing; the types it routes are pinned to
/// DONE_ACTION_TYPES in lib/setup/contract.ts.
public enum DoneActions {
    public static func route(_ action: RowAction) -> DoneRoute? {
        switch action.type {
        case .openURL:
            // Mirrors RowActionDispatcher: an unsupported scheme does nothing.
            guard let raw = action.url, let url = URL(string: raw), url.scheme?.hasPrefix("http") == true else { return nil }
            return .openURL(url)
        case .steps: return .steps(action.steps ?? [])
        // The only run verb a Done row carries is a re-check; Done re-reads the plan itself.
        case .run: return .recheck
        case .choose: return .choose
        case .openSettings, .requestPermission, .connect, .oauth, .install, .ownerOnce, .linkBundled, .chooseFolder, .unknown:
            return nil
        }
    }
}
```

The switch lists every case with no `default`, so a new `ActionType` fails to compile until someone decides whether Done routes it.

- [ ] **Step 4: Run the checks**

Run: `cd rt-tray && swift build && swift run mattstack-checks`
Expected: `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core rt-tray/Tests/MattstackCoreChecks
git commit -m "rt-tray core: choose action, waivable rows, ChoiceClient"
```

---

### Task 10: App UI: ChooseSheet on the checklist, Done and Settings

**Files:**
- Create: `rt-tray/Sources/Setup/Components/ChooseSheet.swift`
- Modify: `rt-tray/Sources/Setup/Screens/ChecklistScreen.swift`, `rt-tray/Sources/Setup/Screens/DoneScreen.swift`, `rt-tray/Sources-core/Setup/FinishGate.swift` (`DoneModel` gains a `ChoiceClient`), `rt-tray/Sources/Setup/SetupWindowController.swift`, `rt-tray/Sources/Settings/GeneralPane.swift`, `rt-tray/Sources/AccessibilityIDs.swift`
- Modify: `rt-tray/Tests/stub-rt/stub.ts` (a `writing-style` scenario)

**Interfaces:**
- Consumes: Task 9.

- [ ] **Step 1: The sheet**

`rt-tray/Sources/Setup/Components/ChooseSheet.swift`:

```swift
import SwiftUI
import MattstackCore

/// One list of choices plus an optional free-text id. `onChoose` runs the
/// verb and returns nil or the failure copy, which stays in the sheet.
struct ChooseSheet: View {
    let title: String
    let options: [ChooseOption]
    let other: ChooseOther?
    let onChoose: (String) async -> String?
    @State private var selection: String?
    @State private var ownId = ""

    init(title: String, options: [ChooseOption], selected: String?, other: ChooseOther?, onChoose: @escaping (String) async -> String?) {
        self.title = title
        self.options = options
        self.other = other
        self.onChoose = onChoose
        // A current value that is not a listed option (a personal skill picked by id) opens in the own-skill field.
        if let selected, options.contains(where: { $0.id == selected }) {
            _selection = State(initialValue: selected)
        } else if let selected {
            _ownId = State(initialValue: selected)
        }
    }
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    private var chosenId: String? {
        let own = ownId.trimmingCharacters(in: .whitespaces)
        return own.isEmpty ? selection : own
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.headline)
            List(options, id: \.id, selection: $selection) { o in
                VStack(alignment: .leading, spacing: 3) {
                    Text(o.label).font(.body.weight(.medium))
                    Text(o.detail).font(.caption).foregroundStyle(.secondary)
                    if let s = o.sample {
                        Text(s).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).lineLimit(3)
                    }
                }
                .padding(.vertical, 4)
                .tag(o.id)
                .accessibilityIdentifier(AXID.chooseOption(o.id))
            }
            .frame(minHeight: 220)
            // Picking a listed style clears the typed id and typing clears the pick, so what is highlighted is what gets saved.
            .onChange(of: selection) { _, new in if new != nil { ownId = "" } }
            if let other {
                VStack(alignment: .leading, spacing: 2) {
                    TextField(other.label, text: $ownId)
                        .onChange(of: ownId) { _, new in if !new.trimmingCharacters(in: .whitespaces).isEmpty { selection = nil } }
                        .accessibilityIdentifier(AXID.chooseOther)
                    Text(other.hint).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.chooseError)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy).accessibilityIdentifier(AXID.chooseCancel)
                Button(busy ? "Saving…" : "Use this style") { submit() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(busy || chosenId == nil)
                    .accessibilityIdentifier(AXID.chooseSubmit)
            }
        }
        .padding(20).frame(width: 480)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.chooseSheet)
    }

    private func submit() {
        guard let id = chosenId else { return }
        busy = true
        error = nil
        Task {
            let failure = await onChoose(id)
            busy = false
            if let failure { error = failure } else { dismiss() }
        }
    }
}
```

Add to `AccessibilityIDs.swift` (match the file's existing style for static lets and functions):

```swift
    static let chooseSheet = "setup.choose"
    static func chooseOption(_ id: String) -> String { "setup.choose.option.\(id)" }
    static let chooseOther = "setup.choose.other"
    static let chooseError = "setup.choose.error"
    static let chooseCancel = "setup.choose.cancel"
    static let chooseSubmit = "setup.choose.submit"
    static let settingsWritingStyleRow = "settings.writingStyle.row"
    static let settingsWritingStyleRowAction = "settings.writingStyle.row.action"
    static let settingsWritingStyleRowStatus = "settings.writingStyle.row.status"
```

- [ ] **Step 2: Wire the checklist**

In `ChecklistScreen.swift` (it already has `let rt: RtRunning` and `model: ReadinessModel` with `afterAction(rowId:)`, used by its `.rtVerb` path; match those names if they differ), add `@State private var choose: PlanRow?`, handle the new dispatch case in `run(_:for:)`:

```swift
        case .chooseOption:
            choose = row
```

and present the sheet beside the existing ones:

```swift
        .sheet(item: $choose) { row in
            ChooseSheet(title: row.title, options: row.action?.options ?? [], selected: row.action?.selected, other: row.action?.other) { id in
                let failure = await ChoiceClient(rt: rt).choose(verb: row.action?.verb ?? [], id: id)
                if failure == nil { await model.afterAction(rowId: row.id) }
                return failure
            }
        }
```

(`PlanRow` is `Identifiable`, so `.sheet(item:)` applies.)

- [ ] **Step 3: Wire the Done screen**

In `FinishGate.swift`, give `DoneModel` a `public let choices: ChoiceClient` and an init parameter `choices: ChoiceClient` beside `waivers`. In `SetupWindowController.swift:39` pass `choices: ChoiceClient(rt: environment.rt)`. Update `DoneModelChecks` call sites of `DoneModel(...)` to pass one.

In `DoneScreen.swift`:

- `@State private var choose: PlanRow?`
- replace the body of `show(_:)` so Done routes only through `DoneActions.route`:

```swift
    private func show(_ row: PlanRow) {
        guard let action = row.action, let route = DoneActions.route(action) else { return }
        switch route {
        case .openURL(let url):
            NSWorkspace.shared.open(url)
            Task { await model.retryCheck() }
        case .steps(let list):
            steps = (title: row.title, steps: list)
        case .recheck:
            Task { await model.retryCheck() }
        case .choose:
            choose = row
        }
    }
```

- gate Skip on the row: wrap the Skip `HStack` in `if row.waivable { ... }`
- present:

```swift
        .sheet(item: $choose) { row in
            ChooseSheet(title: row.title, options: row.action?.options ?? [], selected: row.action?.selected, other: row.action?.other) { id in
                let failure = await model.choices.choose(verb: row.action?.verb ?? [], id: id)
                if failure == nil { await model.retryCheck() }
                return failure
            }
        }
```

- [ ] **Step 4: Settings › General**

In `GeneralPane.swift`, add `@ObservedObject private var readiness: ReadinessModel` (set from `env.readiness` in `init`), `@State private var chooseRow: PlanRow?`, and as the first section:

```swift
            Section("Writing style") {
                if let row = readiness.row("skills.writing-style") {
                    RowView(row: row, isChecking: readiness.checkingRowIds.contains(row.id), rowID: AXID.settingsWritingStyleRow,
                            actionID: AXID.settingsWritingStyleRowAction, statusID: AXID.settingsWritingStyleRowStatus) {
                        if row.action?.type == .choose { chooseRow = row }
                    }
                } else if let e = readiness.lastError {
                    Text("Couldn't read the checklist: \(e)").font(.caption).foregroundStyle(.red)
                } else {
                    Text(readiness.isLoading ? "Checking…" : "No writing-style row in this checklist.").foregroundStyle(.secondary)
                }
            }
```

and on the `Form`:

```swift
        .task { await readiness.load() }
        .sheet(item: $chooseRow) { row in
            ChooseSheet(title: row.title, options: row.action?.options ?? [], selected: row.action?.selected, other: row.action?.other) { id in
                let failure = await ChoiceClient(rt: env.rt).choose(verb: row.action?.verb ?? [], id: id)
                if failure == nil { await readiness.recheckAll() }
                return failure
            }
        }
```

Match the `.task`/`.sheet` placement and `readiness` API names to `FastBrowserPane.swift`, which already hosts a row this way.

- [ ] **Step 5: Stub scenario**

In `rt-tray/Tests/stub-rt/stub.ts`, add a `writing-style` scenario:

- the plan's tools group carries, while `stateGet("style") === 0`, the row `{ id: "skills.writing-style", kind: "tool", title: "Writing style", why: "…", required: false, status: "needs-you", detail: "Choose how your reviews and replies read (or run rt skills writing-style use)", finishGated: true, waivable: false, recheck: "on-change", optionalNote: null, action: { type: "choose", label: "Choose style…", verb: ["skills", "writing-style", "use"], options: <the three presets with label, detail, sample>, other: { label: "Use my own skill…", hint: "Any installed skill id. Start one with rt skills writing-style new." } } }`, and `finishBlockedBy: ["skills.writing-style"]`; once `style` is 1 the row is `ready` with detail `"Sparse (yours)"` and `finishBlockedBy: []`
- `skills writing-style use <id>`: an id matching `^[a-z0-9][a-z0-9._-]*(:[a-z0-9._-]+)?$` and one of the preset ids or `my-voice` sets `style` to 1 and emits `{ skill: id, scope: "user" }`; a bad shape calls `fail("bad-id", ...)`; any other id calls `fail("unknown-skill", "<id> is not installed here. Choose one of: …")`

Follow the file's existing scenario and `args` handling. Run `bun test rt-tray/Tests/stub-rt` and add a stub test for the new scenario in `stub.test.ts` beside the existing ones.

- [ ] **Step 6: Build and run the checks**

Run: `cd rt-tray && swift build && swift run mattstack-checks`
Expected: builds; `0 failed`.

- [ ] **Step 7: Render and look (mandatory)**

Ask the operator before this step: it opens a window on their desktop.

Run the debug build against the stub, never an installed bundle:

```bash
cd rt-tray
chmod +x Tests/stub-rt/stub.ts
RT_STUB_SCENARIO=writing-style RT_STUB_PATH="$PWD/Tests/stub-rt/stub.ts" RT_STUB_STATE_DIR="$(mktemp -d)" .build/debug/rt-tray &
```

Walk to the checklist, then Done, then open Settings › General. For each of the checklist row, the open sheet (with a refusal shown after entering `-rf` in "Use my own skill…"), Done's blocked row (no Skip button), and the Settings section: capture light and dark. Switch appearance per capture with System Settings' Appearance only if the operator agrees; otherwise ask the operator to switch it. Capture a window with `screencapture -x -o -l <windowid> <file>.png`, getting the id from:

```bash
swift -e 'import CoreGraphics; let l = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]; for w in l where (w["kCGWindowOwnerName"] as? String) == "rt-tray" { print(w["kCGWindowNumber"]!, w["kCGWindowName"] ?? "") }'
```

Save captures under the lane's report directory, show them to the operator, and say plainly what looks wrong (clipping, contrast, the sample line wrapping badly, the error text placement) rather than declaring success. Fix and recapture until it reads right. Quit the debug app afterwards.

- [ ] **Step 8: Commit**

```bash
git add rt-tray/Sources rt-tray/Sources-core rt-tray/Tests
git commit -m "rt-tray: ChooseSheet on the checklist, Done and Settings; Skip only on waivable rows"
```

---

### Task 11: Full verification and PR

- [ ] **Step 1: Gates**

Run: `bunx tsc --noEmit`, `bun run test:all`, `bun run picker:check`, `bun run docs:check`, `scripts/repo-purity.sh`, `cd rt-tray && swift run mattstack-checks`
Expected: all green (CI runs `tsc --noEmit` and `docs:check` too), `0 violation(s)`, `ok repo-purity`, `0 failed`.

- [ ] **Step 2: Push and PR**

```bash
git push -u origin HEAD
gh pr create --title "Writing style: setting, rt skills writing-style, setup row and picker" --body "<what each part adds, the no-home-repo guard, the non-waivable gate, the app surfaces, test evidence, and the light/dark captures>"
```

Wait for CodeRabbit's review and address every actionable finding, and wait for CI to go green. The distribution lane reviews. Merge only with the operator's confirmation.

---

### Task 12: Mark `show` agent-safe (after the RT-244 lane merges)

Order against Task 11: if the RT-244 PR has merged by the time this lane's
PR is ready, do this task on the same branch before merge. If it has not,
merge Task 11's PR and do this as a small follow-up PR once RT-244 lands.
Either way, the rt release that ships the setup row must include it, or the
lookup-line work has nothing to call.

**Files:**
- Modify: `lib/command-tree-def.ts`, `lib/__tests__/agent-safe.test.ts`

- [ ] **Step 1: Rebase onto main with RT-244 merged**

Run: `git fetch origin && git rebase origin/main`
Expected: `CommandNode.agentSafe` and `lib/__tests__/agent-safe.test.ts` exist.

- [ ] **Step 2: Update the test first**

Add `"skills writing-style show"` to the sorted list in `agent-safe.test.ts`.
Run: `bun test lib/__tests__/agent-safe.test.ts`
Expected: FAIL (not yet marked).

- [ ] **Step 3: Mark it**

Add `agentSafe: true,` to the `writing-style` › `show` node. `show` reads a setting and a file and writes nothing under either flag it declares.

- [ ] **Step 4: Run and commit**

Run: `bun test lib/__tests__/agent-safe.test.ts lib/mcp`
Expected: PASS.

```bash
git add lib/command-tree-def.ts lib/__tests__/agent-safe.test.ts
git commit -m "skills writing-style show is agent-safe"
```

## Rollout note

The rt release that ships this must carry:

- a marketplace catalog pin that includes the presets (release step 2c, `bash scripts/release/marketplace.sh --refresh`, after the presets lane has merged);
- Task 12 (`show` marked agent-safe) and the RT-244 tool.

Both are the release owner's checks, not tasks here.
