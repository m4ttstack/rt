/**
 * The settings write path (RT-47): `setSetting` — a single, comment-preserving
 * write into one of the three AUTHORED stores (user/team/machine; `default`
 * is a read-only rung and never appears here).
 *
 * Writes go through jsonc-parser's `modify`/`applyEdits` rather than
 * parse-mutate-stringify, so existing comments and formatting in the store
 * file survive a write to an unrelated key (verified: `modify` only rewrites
 * the minimal edit range needed for the touched path; everything else in the
 * document — including comments — is untouched text).
 *
 * JSONPath segments are literal object keys, not `.`-namespaced walks: a
 * global write targets `[key]` (e.g. `["rt.hooks"]`) and a repoScoped write
 * targets `["repos", identity, key]`. A dotted key like `"rt.roles"` is one
 * path segment, not two — jsonc-parser never splits on `.` (verified with a
 * throwaway script against the installed 3.3.1). Missing parents (`"repos"`,
 * or the identity's section under it) are created by `modify` itself, and
 * that creation is comment-safe — no special-casing needed here.
 *
 * Creating an absent store file (user/machine only — see "Team selection"
 * below for why team stores are never auto-created): the file is seeded
 * in-memory as `// header comment\n{}\n` BEFORE the first `modify` call.
 * This is required, not cosmetic — a verified footgun: running `modify` on a
 * comment-only document with NO braces at all (e.g. just `// header\n`)
 * places the new object first and re-emits the header AFTER the closing
 * brace, which is backwards. Seeding an empty object ahead of time gives
 * `modify` real JSON structure to edit into, and the header comment stays
 * exactly where it was written, above the object.
 *
 * ── Refusals ────────────────────────────────────────────────────────────
 * In order: unregistered key, migrated:false (naming `def.legacyFile`), a
 * scope the def does not list, a
 * repoIdentity supplied for a key that is not `repoScoped`, `validate-write.ts`'s
 * `validateWrite` (type check and path-literal guard, then the layer schema,
 * then the merged result), and finally, only for `scope: "team"`, a team
 * store that cannot be resolved (see below). Filesystem-touching checks (team
 * resolution) run last, after every pure/in-memory refusal, so a bad call
 * never creates or touches a file it was going to refuse anyway. Last of all,
 * at the store seam itself (so `unsetSetting` is covered too), a test run may
 * not touch a store under the account's real ~/.mattstack (test-isolation.ts).
 *
 * ── The path-literal guard is scope-aware ──────────────────────────────
 * `validateWrite` mirrors `resolve.ts`'s `validateForScope`: `def.pathGuardFields`
 * (wave 1: `rt.roles.hook`) is enforced at `user` and `team` scope, where a
 * path literal would silently stop applying the moment a teammate's checkout
 * (or this developer's own machine) sits at a different path. `machine` scope
 * is exempt: it is the one store where a path literal is the CORRECT way to
 * express something local-only, so writes there skip the guard entirely.
 *
 * ── Team selection (a design decision this task made, per the brief) ──
 * The base signature (`setSetting(key, value, scope, opts?)`) is extended
 * here with `opts.team`, an explicit team NAME to target. Selection rule for
 * `scope: "team"`:
 *   - `opts.team` given → that team's store; refuse if it has no local
 *     settings file (a team dir can exist mid-clone without one — see
 *     `stores.ts#listTeams`).
 *   - `opts.team` omitted, exactly one team has a local store → use it.
 *   - `opts.team` omitted, zero or multiple teams have a local store →
 *     refuse with a clear error (asking for `opts.team` in the multiple
 *     case). Wave 1 ships exactly one team, so this is the common path; the
 *     alternative of silently picking "the first team alphabetically" was
 *     considered and rejected — guessing which team's shared file to mutate
 *     is exactly the silent-oracle behavior this design bans elsewhere.
 * A team store is NEVER auto-created by `setSetting` — team stores are
 * seeded by the migration/orchestrator step and live in a repo that needs a
 * commit+push to reach teammates; conjuring one here would produce an
 * uncommitted, unshared file masquerading as team state.
 *
 * Every successful `scope: "team"` write prints one reminder line to
 * stderr: the edit only exists in this local clone until it is committed
 * and pushed. No such reminder for `user`/`machine` (nothing to push there
 * in wave 1).
 *
 * ── Malformed stores refuse rather than edit around the damage ─────────
 * An existing store's on-disk text is parsed and checked (`assertEditableJsonc`)
 * before `modify` ever runs: real parse errors, a non-object root, or a
 * duplicate key anywhere in the tree all refuse with one message naming the
 * file. The duplicate-key case is the sharp one — it is not a parse error at
 * all (JSON's grammar permits it), but `modify` edits the FIRST occurrence by
 * offset while every reader takes the LAST, so a naive edit-in-place would
 * report success while the effective value never changes, and the file would
 * still degrade to empty on the next `readStore`. Refusing is the only
 * option that doesn't either lie about success or write a still-broken file.
 *
 * ── Writes are write-temp-then-rename ───────────────────────────────────
 * Mirrors `lib/json-store.ts`'s `writeJson`: the edited text is written to a
 * `<path>.<pid>.<random>.tmp` file in the SAME directory, then renamed onto
 * the real path — stores never tear, matching the rest of rt's persistence.
 * All three stores are tracked repos now, but nothing auto-commits a write
 * (H2, the snapshot daemon, is unbuilt) — a torn write would sit as a
 * corrupt uncommitted file until a human noticed. The tmp file carries the
 * edited TEXT exactly as `applyEdits` produced it, never round-tripped
 * through `JSON.stringify` — that's what keeps comments alive.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { applyEdits, modify, parse, parseTree, type JSONPath, type Node, type ParseError } from "jsonc-parser";
import { randomBytes } from "crypto";
import { dirname } from "path";
import { assertNotRealStoreInTest } from "../test-isolation.ts";
import { baselinesOf, baselinesToRecord, currentStoreName, MIGRATED_PROP, olderStoreNames, readSection } from "./migrate.ts";
import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "./paths.ts";
import { getDef, isMigrated, isRetiredKey, type SettingDef, type SettingScope } from "./registry-machinery.ts";
import { listTeams } from "./stores.ts";
import { isJoinedTeam } from "./team-local-read.ts";
import { validateWrite } from "./validate-write.ts";

export interface SetSettingOpts {
  /** Normalized repo identity — required to target a repoScoped key's `repos.<identity>` section. */
  repoIdentity?: string;
  /**
   * Which team's local store to write into, for `scope: "team"`. See the
   * module doc's "Team selection" section. Ignored for `user`/`machine`.
   */
  team?: string;
}

const FORMAT = { tabSize: 2, insertSpaces: true, eol: "\n" };

function refuse(message: string): never {
  throw new Error(`rt: ${message}`);
}

interface StoreEdit {
  path: JSONPath;
  value: unknown;
}

function sectionOf(root: Record<string, unknown>, repoIdentity: string | undefined): Record<string, unknown> | undefined {
  if (repoIdentity === undefined) return root;
  const repos = root.repos;
  if (repos === null || typeof repos !== "object" || Array.isArray(repos)) return undefined;
  const section = (repos as Record<string, unknown>)[repoIdentity];
  return section !== null && typeof section === "object" && !Array.isArray(section) ? (section as Record<string, unknown>) : undefined;
}

function sectionPathOf(repoIdentity: string | undefined): JSONPath {
  return repoIdentity !== undefined ? ["repos", repoIdentity] : [];
}

/**
 * Writes `value` for `key` into the given scope's store, preserving every
 * existing comment and creating the file/section it needs. See the module
 * doc for the full refusal list and the team-selection rule.
 */
export function setSetting(key: string, value: unknown, scope: SettingScope, opts: SetSettingOpts = {}): void {
  const def = getDef(key);
  if (!def) {
    refuse(`unknown setting "${key}" — not in the settings registry (see \`rt settings list\`)`);
  }

  if (!isMigrated(def)) {
    refuse(migratedFalseMessage(key, def));
  }

  if (!def.scopes.includes(scope)) {
    refuse(`"${key}" cannot be set in the ${scope} store (allowed: ${def.scopes.join(", ")})`);
  }

  if (opts.repoIdentity !== undefined && def.repoScoped !== true) {
    refuse(`"${key}" is not repo-scoped — omit the repo identity`);
  }

  const verdict = validateWrite(def, value, { scope, repoIdentity: opts.repoIdentity, team: opts.team });
  if (!verdict.ok) {
    const hint = verdict.kind === "pathGuard" ? "; use ${team:<name>} or ${repoRoot} instead" : "";
    refuse(`refusing to set "${key}": ${verdict.reason}${hint}`);
  }

  const storePath = resolveStorePath(scope, opts);
  const sectionPath = sectionPathOf(opts.repoIdentity);
  const name = currentStoreName(def);

  writeIntoStore(
    storePath,
    (root) => {
      const section = sectionOf(root, opts.repoIdentity);
      const baselines = baselinesToRecord(def, section);
      if (Object.keys(baselines).length === 0) return [{ path: [...sectionPath, name], value }];
      const rawMigrated = section?.[MIGRATED_PROP];
      // A garbage $migrated (null, an array, a string) cannot take a property edit
      // underneath it — jsonc-parser's modify throws adding an index to it — so it is
      // replaced wholesale with a fresh object holding only the new baselines.
      const migratedIsObject = rawMigrated === undefined || (rawMigrated !== null && typeof rawMigrated === "object" && !Array.isArray(rawMigrated));
      return [
        { path: [...sectionPath, name], value },
        ...(migratedIsObject
          ? Object.entries(baselines).map(([older, hash]) => ({ path: [...sectionPath, MIGRATED_PROP, older], value: hash }))
          : [{ path: [...sectionPath, MIGRATED_PROP], value: baselines }]),
      ];
    },
    /* createIfMissing */ scope !== "team",
  );

  // All three stores are tracked repos with nothing auto-committing a write
  // (H2, the snapshot daemon, is unbuilt) — every scope gets the reminder,
  // not just team.
  console.error(
    `rt: wrote "${key}" to the local ${scope} store (${storePath}) — this is local only until you commit and push it.`,
  );
}

/**
 * Removes `key` from the given scope's store, comment-preserving. The refusal
 * ladder is `setSetting`'s minus the value check (there is no value): unknown
 * key, unmigrated, scope not in `def.scopes`, repoIdentity on a non-repoScoped
 * key, and the team-selection rule when ambiguous. Divergences from set, both
 * because removal has nothing to act on: a store FILE that does not exist is a
 * clean no-op rather than a refusal (an explicit `opts.team` naming a team
 * with no local store included — nothing to remove is success, not an error),
 * and a key not present in the store is a no-op. Returns whether anything was
 * actually removed; the local-only reminder prints only on a real removal.
 * A retired key is not in the registry but may linger in a store, so it can
 * still be removed from any scope.
 */
export function unsetSetting(key: string, scope: SettingScope, opts: SetSettingOpts = {}): boolean {
  const def = getDef(key);
  if (!def && isRetiredKey(key)) {
    if (opts.repoIdentity !== undefined) refuse(`"${key}" is not repo-scoped; omit the repo identity`);
    return removeKeyFromScope(key, scope, opts, () => [[key]]);
  }
  if (!def) {
    refuse(`unknown setting "${key}" — not in the settings registry (see \`rt settings list\`)`);
  }

  if (!isMigrated(def)) {
    refuse(migratedFalseMessage(key, def));
  }

  if (!def.scopes.includes(scope)) {
    refuse(`"${key}" cannot be unset in the ${scope} store (allowed: ${def.scopes.join(", ")})`);
  }

  if (opts.repoIdentity !== undefined && def.repoScoped !== true) {
    refuse(`"${key}" is not repo-scoped — omit the repo identity`);
  }

  const sectionPath = sectionPathOf(opts.repoIdentity);
  return removeKeyFromScope(key, scope, opts, (root) => {
    const section = sectionOf(root, opts.repoIdentity);
    if (!section) return [];
    const diverged = readSection(def, section, { layer: true }).older.filter((o) => o.label === "diverged");
    if (diverged.length > 0) {
      refuse(
        `"${key}" has an older store name edited after its current one (${diverged.map((o) => o.storeName).join(", ")}) in the ${scope} store; compare both values with \`rt settings migrate\`, then remove the older one with \`rt settings migrate --prune --force ${key}\` (add --team for a team-store name); prune lists every name it will delete before asking to confirm`,
      );
    }
    const names = [currentStoreName(def), ...olderStoreNames(def).map((o) => o.name)].filter((n) => section[n] !== undefined);
    const baselines = baselinesOf(section);
    return [
      ...names.map((n) => [...sectionPath, n]),
      ...names.filter((n) => baselines[n] !== undefined).map((n) => [...sectionPath, MIGRATED_PROP, n]),
    ];
  });
}

function removeKeyFromScope(key: string, scope: SettingScope, opts: SetSettingOpts, planPaths: (root: Record<string, unknown>) => JSONPath[]): boolean {
  const storePath = resolveStorePathForUnset(scope, opts);
  if (storePath === null || !existsSync(storePath)) return false;

  const removed = removeFromStore(storePath, planPaths);

  if (removed) {
    console.error(
      `rt: removed "${key}" from the local ${scope} store (${storePath}) — this is local only until you commit and push it.`,
    );
  }
  return removed;
}

function migratedFalseMessage(key: string, def: SettingDef): string {
  const legacyPart = def.legacyFile ? ` — it is still read from ${def.legacyFile}` : "";
  return `"${key}" is not writable through the settings resolver yet${legacyPart}`;
}

/**
 * A clone that arrived by redeeming an invite is pull-only, so a write here
 * would never reach the team AND would leave a tracked file dirty, which is
 * enough on its own to make the daemon's fast-forward pull fail.
 */
function refuseIfJoined(team: string): void {
  if (isJoinedTeam(team)) {
    refuse(
      `this machine joined "${team}" by invite, so its clone is pull-only and team settings cannot be written here. Ask the team's owner to make this change. Member-proposed changes are tracked in MAT-415.`,
    );
  }
}

/** Resolves which store file a write targets, applying the team-selection rule for `scope: "team"`. */
function resolveStorePath(scope: SettingScope, opts: SetSettingOpts): string {
  if (scope === "user") return userSettingsPath();
  if (scope === "machine") return machineSettingsPath();

  if (opts.team !== undefined) {
    const path = teamSettingsPath(opts.team);
    if (!existsSync(path)) {
      refuse(`team store for "${opts.team}" does not exist (${path}) — clone/seed it before writing to it`);
    }
    refuseIfJoined(opts.team);
    return path;
  }

  const teams = listTeams();
  if (teams.length === 0) {
    refuse(`no local team store found — clone a team under ~/.mattstack/teams/<name> or pass opts.team`);
  }
  if (teams.length > 1) {
    refuse(`multiple local team stores found (${teams.join(", ")}) — pass opts.team to choose one`);
  }
  const team = teams[0] as string;
  refuseIfJoined(team);
  return teamSettingsPath(team);
}

/**
 * `resolveStorePath` for removal: same selection rule, but "no store to
 * target" answers null (nothing to remove) instead of refusing — EXCEPT the
 * multiple-teams case, which still refuses: guessing which team's store to
 * edit is banned on the unset side for the same reason as the set side.
 */
function resolveStorePathForUnset(scope: SettingScope, opts: SetSettingOpts): string | null {
  if (scope === "user") return userSettingsPath();
  if (scope === "machine") return machineSettingsPath();

  if (opts.team !== undefined) {
    const path = teamSettingsPath(opts.team);
    if (!existsSync(path)) return null;
    refuseIfJoined(opts.team);
    return path;
  }

  const teams = listTeams();
  if (teams.length === 0) return null;
  if (teams.length > 1) {
    refuse(`multiple local team stores found (${teams.join(", ")}) — pass opts.team to choose one`);
  }
  const team = teams[0] as string;
  refuseIfJoined(team);
  return teamSettingsPath(team);
}

/** `// header comment\n{}\n` — see module doc for why the object must be seeded before the first `modify`. */
function seedHeader(): string {
  return `// rt settings — created by \`rt settings set\`. JSONC: comments and trailing commas are fine.\n{}\n`;
}

/**
 * Refuses to edit a store whose on-disk text is not a single well-formed
 * JSONC object. Two failure classes:
 *  - genuine parse errors (unbalanced braces, trailing garbage, etc.) —
 *    caught by jsonc-parser's own error collection, the same check
 *    `stores.ts#readStore` runs on the read side;
 *  - a document that PARSES but is unsafe to `modify`: a non-object root, or
 *    a duplicate key anywhere in the tree. `modify` edits the FIRST
 *    occurrence of a duplicate key by offset, while every reader (`parse`,
 *    `JSON.parse`) takes the LAST — so a naive edit-in-place would report
 *    success while the effective value never changes (verified with a
 *    throwaway script: `modify` touched offset 14 in `{"rt.hooks":1,"rt.hooks":2}`,
 *    but re-parsing the "fixed" text still returned `2`). Both classes refuse
 *    rather than silently editing around the damage — the alternative is a
 *    write that reports success but does nothing, or one that writes a still-
 *    broken file that the NEXT read honest-degrades to an empty store.
 */
function assertEditableJsonc(file: string, content: string): void {
  const errors: ParseError[] = [];
  const tree = parseTree(content, errors, { allowTrailingComma: true });

  const malformed =
    errors.length > 0 || tree === undefined || tree.type !== "object" || findDuplicateKey(tree) !== undefined;

  if (malformed) {
    refuse(`fix the JSONC syntax error in ${file} first — refusing to edit a malformed store`);
  }
}

/** Depth-first search for the first duplicate property name in any object in the tree. */
function findDuplicateKey(node: Node): string | undefined {
  if (node.type === "object" && node.children) {
    const seen = new Set<string>();
    for (const property of node.children) {
      const keyNode = property.children?.[0];
      if (keyNode !== undefined && typeof keyNode.value === "string") {
        if (seen.has(keyNode.value)) return keyNode.value;
        seen.add(keyNode.value);
      }
      const valueNode = property.children?.[1];
      if (valueNode !== undefined) {
        const nested = findDuplicateKey(valueNode);
        if (nested !== undefined) return nested;
      }
    }
    return undefined;
  }
  if (node.type === "array" && node.children) {
    for (const child of node.children) {
      const nested = findDuplicateKey(child);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function writeIntoStore(storePath: string, planEdits: (root: Record<string, unknown>) => StoreEdit[], createIfMissing: boolean): void {
  assertNotRealStoreInTest(storePath);
  let content: string;
  if (existsSync(storePath)) {
    content = readFileSync(storePath, "utf8");
    if (content.trim() === "") {
      content = seedHeader();
    } else {
      assertEditableJsonc(storePath, content);
    }
  } else {
    if (!createIfMissing) {
      // Unreachable via setSetting today: resolveStorePath already refuses
      // every "team" path that lacks a file before we get here. Kept as a
      // defensive guard against a future caller of writeIntoStore directly.
      refuse(`store file ${storePath} does not exist`);
    }
    mkdirSync(dirname(storePath), { recursive: true });
    content = seedHeader();
  }

  const root = (parse(content, [], { allowTrailingComma: true }) ?? {}) as Record<string, unknown>;
  let next = content;
  for (const edit of planEdits(root)) {
    next = applyEdits(next, modify(next, edit.path, edit.value, { formattingOptions: FORMAT }));
  }
  const finalText = next.endsWith("\n") ? next : `${next}\n`;

  // Write-temp-then-rename in the same directory, mirroring
  // lib/json-store.ts's writeJson — stores never tear. All three stores are
  // tracked repos now, but nothing auto-commits a write (H2 is unbuilt), so
  // a torn write would sit as a corrupt uncommitted file until a human
  // noticed. The edited TEXT is written as-is, never round-tripped through
  // JSON.stringify, so comments and formatting survive.
  writeTempThenRename(storePath, finalText);
}

/**
 * Removes every path `planPaths` plans against the store's root from an
 * existing store file. A path that isn't present yields zero edits from
 * `modify`, and the resulting text is compared byte-for-byte against the
 * original: no textual change means no write and no mtime churn. Malformed
 * stores refuse exactly as on the set side...
 * `modify`-by-offset against a duplicate-key document is as wrong for
 * removal as it is for writes.
 */
function removeFromStore(storePath: string, planPaths: (root: Record<string, unknown>) => JSONPath[]): boolean {
  assertNotRealStoreInTest(storePath);
  const content = readFileSync(storePath, "utf8");
  if (content.trim() === "") return false;
  assertEditableJsonc(storePath, content);

  const root = (parse(content, [], { allowTrailingComma: true }) ?? {}) as Record<string, unknown>;
  const paths = planPaths(root);
  let next = content;
  for (const path of paths) next = applyEdits(next, modify(next, path, undefined, { formattingOptions: FORMAT }));
  next = dropEmptyMigrated(next, paths);
  if (next === content) return false;

  writeTempThenRename(storePath, next.endsWith("\n") ? next : `${next}\n`);
  return true;
}

/** A `$migrated` map emptied by this removal goes too; one left non-empty stays. */
function dropEmptyMigrated(content: string, removed: JSONPath[]): string {
  let next = content;
  const owners = new Set(removed.filter((p) => p.at(-2) === MIGRATED_PROP).map((p) => JSON.stringify(p.slice(0, -1))));
  for (const owner of owners) {
    const path = JSON.parse(owner) as string[];
    const root = parse(next, [], { allowTrailingComma: true }) as unknown;
    const node = path.reduce<unknown>((at, seg) => (at !== null && typeof at === "object" ? (at as Record<string, unknown>)[seg] : undefined), root);
    if (node !== null && typeof node === "object" && Object.keys(node).length === 0) {
      next = applyEdits(next, modify(next, path, undefined, { formattingOptions: FORMAT }));
    }
  }
  return next;
}

function writeTempThenRename(storePath: string, finalText: string): void {
  const tmp = `${storePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, finalText);
    renameSync(tmp, storePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // tmp file never got created, or was already cleaned up — nothing to do
    }
    throw err;
  }
}

export interface PruneOpts extends SetSettingOpts {
  /** Delete the name even when it diverged from the current one. */
  force?: boolean;
}

/**
 * Deletes one older store name of `key`, and its `$migrated` baseline, from
 * a section whose current name is present. Its own path rather than
 * unsetSetting: the name is not a registry key, and a diverged name needs
 * `force`. `authored` is the value it removed.
 */
export function pruneStoreName(key: string, storeName: string, scope: SettingScope, opts: PruneOpts = {}): { removed: boolean; authored?: unknown } {
  const def = getDef(key);
  if (!def) refuse(`unknown setting "${key}"; not in the settings registry (see \`rt settings list\`)`);
  if (!def.scopes.includes(scope)) refuse(`"${key}" is not stored in the ${scope} store (allowed: ${def.scopes.join(", ")})`);
  if (opts.repoIdentity !== undefined && def.repoScoped !== true) refuse(`"${key}" is not repo-scoped; omit the repo identity`);
  if (!olderStoreNames(def).some((o) => o.name === storeName)) refuse(`"${storeName}" is not an older store name of "${key}"`);

  const storePath = resolveStorePathForUnset(scope, opts);
  if (storePath === null || !existsSync(storePath)) return { removed: false };
  const sectionPath = sectionPathOf(opts.repoIdentity);
  let authored: unknown;
  const removed = removeFromStore(storePath, (root) => {
    const section = sectionOf(root, opts.repoIdentity);
    if (section?.[storeName] === undefined) return [];
    const current = currentStoreName(def);
    if (section[current] === undefined) {
      refuse(`"${key}" has no "${current}" in the ${scope} store yet; run \`rt settings migrate --write\` before pruning "${storeName}"`);
    }
    const older = readSection(def, section, { layer: true }).older.find((o) => o.storeName === storeName)!;
    if (older.label === "diverged" && opts.force !== true) {
      refuse(`"${storeName}" diverged from "${current}" in the ${scope} store; deleting it needs force`);
    }
    authored = older.authored;
    return [[...sectionPath, storeName], ...(baselinesOf(section)[storeName] !== undefined ? [[...sectionPath, MIGRATED_PROP, storeName]] : [])];
  });
  if (!removed) return { removed };
  console.error(`rt: removed "${storeName}" from the local ${scope} store (${storePath}); this is local only until you commit and push it.`);
  return { removed, authored };
}
