# The mattstack settings architecture

How every mattstack app (rt, deck, board, gitq) declares, reads, and writes
human-intent configuration. Read this before adding a key, porting an app, or
building anything that touches `~/.mattstack`. The dated design records live in
`docs/superpowers/specs/` (2026-08-20 suite spec, [2026-08-21 re-root spec](superpowers/specs/2026-08-21-home-repo-reroot.md)) and
Linear (MAT-374, RT-30/31/32); this file is the live contract.

## The three-layer rule

Every piece of app state is exactly one of:

1. **Human intent** → a settings store (git-backed, this document).
2. **Secret** → the sops/age-encrypted store under `user/secrets/` — NEVER a
   settings store, never plaintext on disk. Consumers read env-first, then the
   rt daemon's token-gated `secrets:read` verb (`lib/daemon/handlers/secrets.ts`,
   per-caller scopes with explicit whitelists).
3. **Runtime** → plain files under `~/.mattstack/<app>/` (state dirs: `rt/`,
   `deck/`, `shepherdr/`, `repos/`, `ci-attendants/`, `work/`). Machine-local,
   re-derivable or acceptable-to-lose, never in git.

If something is neither re-derivable nor declared, it is mis-filed — promote it
to a store or the secrets layer.

## Stores and scopes

Precedence: `default < team < user < team.repo < user.repo < machine < machine.repo`
(VS Code-style most-specific-wins; repo sections are keyed by normalized remote
identity `host/path` — the RAW form, never the serialized `remote:…` wire form
that keys everything outside the settings stores; [repo-identity.md](repo-identity.md)
is the contract for which form goes where). On disk — scope in the filename,
identity in the path:

| Scope   | File | Tracked in |
|---|---|---|
| team    | `~/.mattstack/teams/<team>/mattstack/settings.team.jsonc` | the team's own repo |
| user    | `~/.mattstack/user/settings.user.jsonc` | the personal repo (`mattstack-home`) |
| machine | `~/.mattstack/user/local/<machine-key>/settings.local.jsonc` | the personal repo — tracked and KEYED per machine ("travels keyed"); machines never share a profile |

`~/.mattstack` itself is a plain directory, not a repo — `~/.mattstack/user` IS
the personal repo. The machine key is the hostname slug, overridable by the
untracked `~/.mattstack/machine-key` file; `machineKey()` in `lib/rt-paths.ts`
is the authority (override honored only as a safe single path segment). The rt
snapshot daemon auto-commits and pushes the personal repo (debounced; claimed
zones in `user/snapshot-owners.jsonc` excluded; `rt home claim|release`), so
every store write becomes a `snapshot:` commit within ~80s — by design.
The same engine runs one instance per team clone under `~/.mattstack/teams/`
(`rt.teamSnapshot`, machine scope): it commits only `mattstack/`, `.sops.yaml`
and `.claude-plugin/`, pulls (fast-forward or rebase) at boot, every
`pullIntervalSec` and before every push, and surfaces a rebase conflict as
the `team.sync` checklist row instead of resolving it. So a `--scope team`
write or a `members sync` reaches every member's machine without a hand
commit, publish, or pull (`docs/home-repo.md`, "Team clones").

## The resolver and registry

One in-process resolver for the whole suite, in `@mattstack/rt-client`
(`packages/rt-client/src/settings/`): `getSetting(key)` re-reads the stores on
every call (no memoization); `setSetting(key, value, scope, opts)` does
comment-preserving jsonc edits with a refusal ladder (malformed/duplicate-key
files are never blind-edited). `lib/rt-paths.ts` is the PATH authority —
change it first, mirror in `packages/rt-client/src/settings/paths.ts`
(`lib/__tests__/settings-paths-parity.test.ts` fails the build on divergence).

Every key is declared in the suite registry
(`packages/rt-client/src/settings/registry-defs.ts`): name, type, allowed
scopes, merge (`deep` merges across scopes for objects), description, optional
default. Prefixes: `rt.*`, `deck.*`, `board.*`, `gitq.*`, `mattstack.*`,
`claude.*`, and `setup.*` for machine-local installer state such as
`setup.waived`. `rt settings set/get/explain/list` accept any registered key;
`rt settings explain <key>` shows per-scope provenance and is the first
debugging move.

Apps read IN-PROCESS via rt-client (deck boots before the daemon, so daemon
round-trips for settings are wrong by design); the daemon's settings verbs
exist for out-of-process callers only.

## Adding a key (the checklist)

1. Add the registry row in `registry-defs.ts` (pick the scope by who the intent
   belongs to: team convention / this human everywhere / this machine).
2. For an `object` or `array` key, write its zod schema in `SCHEMAS`
   (`packages/rt-client/src/settings/registry-schemas.ts`): the value the code
   reading it accepts, not an ideal. `z.looseObject` unless a reader rejects
   unknown properties (`z.strictObject`), `.optional()` on anything a reader
   falls back on, the most important property first (a refusal names the
   first failing path). Where readers disagree, follow the most permissive.
   Readers take their type from it with `import type { Value } from
   "./settings/registry-schemas.ts"` (`Value<"rt.roles">`), which erases at
   build.
3. Add the key's `EXAMPLES` entry in `settings/__tests__/schema-examples.ts`:
   at least one `good` value, one `bad` value with the path its first issue
   must name, and for a `merge: "deep"` key one partial `layer`. The registry
   default must pass too. The example suite fails for a composite key with no
   schema or no entry.
4. `bun run cli.ts settings schema lock` regenerates `schema.lock.json`;
   commit it with the schema. CI regenerates it and fails on any difference.
5. `cd packages/rt-client && bun run build`: dist is what consumers copy, and
   the dist-freshness test fails otherwise.
6. Deliver the new registry to every consumer: a node_modules copy never
   updates itself. A `file:` consumer (console) re-copies on `bun install`;
   the apps pinned to the published package (gitq, board) only see the key
   after an rt-client version bump + publish + install; deck additionally
   BUNDLES rt-client into its compiled binary, so it needs a rebuild +
   fresh-inode install + `codesign -f -s -` to pick up path or registry
   changes.
7. Read via `getSetting`, write via `setSetting`. Never construct store paths
   by hand; never cache a path or a value at module load.

## Schemas, the write gate and the lock

zod is authoring-only: a devDependency of rt-client that nothing on the
runtime path imports (a test greps `dist/index.js` for it). The committed
lock, `packages/rt-client/src/settings/schema.lock.json`
(`{ [key]: { storeVersion, schema } }`, JSON Schema from `z.toJSONSchema(schema,
{ io: "input" })`), is a static import the registry attaches to each def as
`def.schema`, so the lock and the running checks cannot disagree. A
`merge: "deep"` object key also carries `def.layerSchema`: the same schema with
`required` dropped at every object level outside array items, because one
layer holds only the fields it sets. Every check, server or browser, runs
through `@cfworker/json-schema`, and an issue is `{ path, message }` with the
path formatted `[0].pattern` or `emoji.looking`.

- **Writes are strict.** `validateWrite(def, value, { scope, repoIdentity?,
  team? })` is the one gate, and `setSetting`, `rt settings set` and
  settings-kit's `/set` all go through it: `validateValue` (type and path
  guard), then the layer (the layer schema for a deep key, the full schema
  otherwise), then the merged result against the full schema. The merged
  check refuses only a write that makes a passing merge fail, so a layer
  already broken elsewhere never blocks an unrelated edit. A team write
  names one team and merges only that team's store. A global write of a
  repo-scoped key checks the merge with no repo and once per repo that has a
  section in any store.
- **Reads are lenient.** `validateValue` alone is the resolver's skip rule
  (`invalid`). A value that fails only its schema stays in effect and is
  labeled `nonconforming`, with its issues, in `explain` and `list`; a
  merged value that fails the full schema is reported as `mergedIssues`.
- **`rt settings check`** lists every stored value (team, user and machine
  stores, global and repo sections) that fails its type check or layer
  schema, every merged value that fails the full schema, and the
  unregistered keys found in stores. It is read-only, uses the registry of
  the rt that runs it, takes `--json`, and exits 1 on any finding except an
  unregistered key. A finding against a real store is fixed in the schema,
  never in the store.
- **Breaking changes.** `bun run cli.ts settings schema diff` classifies the
  registry's schemas against a lock: `origin/main` by default,
  `--against-ref <ref>` or `--against <file>` (one or the other), `--json`
  for the envelope; it runs from source only. A change is breaking when it
  can reject a value the previous schema accepted: a key removed; a property
  made required; a `type` narrowed or replaced, or added where there was none; an `enum`/`const` value
  removed, or one added where none was; an `anyOf` branch removed or
  tightened, or `anyOf` added; a `oneOf` branch added or removed, or `oneOf`
  added (dropping `oneOf` entirely is safe); a limit added or tightened;
  `pattern`/`format` added or changed; `items` or `propertyNames` added or
  tightened; `additionalProperties` tightened; `prefixItems` added or
  changed, or dropped while `items` stays restrictive; a property added where
  extras were checked by a schema; a property removed where the new extras
  are not open; and any change to a keyword outside the known set.
  Annotations (`title`, `description`, `default`, `labels`, `placeholder`
  and the like) never count, except inside a `oneOf` branch, which is
  compared as a whole.
  A breaking change passes only when the key's `storeVersion` went up and
  `breaking-schema-changes.json` (next to the registry) gives the key a
  one-line reason; a removed key needs only the reason. CI runs the diff
  against `main` on every PR, and release preflight's `schema lock` row runs
  it against the lock at the previous release tag.
- A typed optional property added to a loose object is safe for the
  classifier but can collide with a stored extra of the same name and a
  different type; `rt settings check` before release is what catches that.

## Changing a key's shape (store versions and migrations)

A breaking schema change gives the key a new store name instead of
rewriting values in place: `key` at `storeVersion` 1, `key@N` above it.
Code keeps using the plain key. Readers on an older rt-client keep reading
the name they know; the resolver on the new one reads `key@N`, else the
highest older name it can migrate (`migrateFrom` steps in
`packages/rt-client/src/settings/migrations/index.ts`, run in memory).

- Every write lands on the current name. The first write of `key@N` into a
  section records `$migrated: { <older name>: <hash> }` for the older names
  there; afterwards an older name is `leftover` (its migrated value equals
  the current one), `stale` (unchanged since) or `diverged` (edited or
  created after). `$`-prefixed properties are store metadata.
- To change a shape: edit the zod schema, run `rt settings schema diff
  --draft` (it writes the step and the previous version's schema into
  `migrations/index.ts` and `migrations/schemas.ts`), finish any step that
  throws `TODO`, add real (invented) examples, bump `storeVersion` in
  `registry-defs.ts`, then `rt settings schema lock`. CI fails a breaking
  change until the bump and a `migrateFrom` entry matching main's lock are
  in; the proof test runs every step over generated samples.
- A renamed key lists its old key in `RENAMES` and keeps its version; the
  old key's names read as older names of the new one.
- `rt settings migrate` shows what is stored under older names; `--write`
  adds current names (additive, safe for every reader); `--prune` deletes
  leftover and stale older names after confirmation, the team store only
  with `--team`, a diverged one only with `--force <key>`.
- `rt settings check` fails on a diverged name or a value the chain cannot
  carry; release preflight runs the candidate's check against the real
  stores.

## Porting an app's config (the ownership latch)

When a key migrates from an app's own config file, the transition pattern is:
`getSetting(KEY).value === undefined` ⇒ the store does NOT own the key ⇒ read
(and write) the legacy file as before; probe failures (try/catch) count as
unowned plus ONE warning that never echoes values. Once the store owns the key
it wins (per-field for field-bag objects, wholesale for maps — document which),
and store values go through the SAME validators as file values. Writers hitting
ENOENT on the legacy file write the store instead (file-authority is
meaningless with no file). The cutover imports live values, VERIFIES the write
actually persisted, then renames the legacy file to `<name>.migrated` — never
unlinks it, so an interrupted run loses nothing and a corrupt file (left in
place, unrenamed) stays recoverable by hand. Verifying is not optional:
`persistOrWarn` swallows `SQLITE_BUSY`, so a write that returned is not
necessarily a write that landed. Reference implementations:
`lib/state/legacy-import.ts`, `lib/run-history.ts`,
`extensions/vscode/rt-context/src/branchNaming.ts`, `apps/board/src/config.ts`,
`gitq/src/core/{worktrees,forges}.ts`, `apps/deck/src/api/platform-settings.ts`.

**Invariant: keys behind an ownership latch must carry NO registry `default`** —
a default materializes as a present value and flips the key store-authoritative
on every install (stated at the `board.*` block in registry-defs).

## Footguns (each cost a real debugging session)

- Bun freezes `os.homedir()` and the spawn-PATH at process start. Resolve HOME
  at call time (`process.env.HOME ?? homedir()`) everywhere; tests repoint
  `process.env.HOME` at a temp dir via a bunfig preload — never remove those
  preloads, and never let a test touch the real `~/.mattstack`. bun reads
  `bunfig.toml` only from the cwd, so run tests from the repo root; a
  test-run write into the account's real stores throws instead of landing
  (`packages/rt-client/src/test-isolation.ts`).
- `file:` dependencies are COPIES (see step 3 above). Stale copies fail
  silently — old paths resolve nothing and every key reads as unset.
- sops resolves `.sops.yaml` and its `path_regex` relative to the spawn cwd;
  the cwd pin, the regex, and the `--filename-override` move in lockstep
  (`lib/secrets/store.ts`), and decrypting a `.tmp` staging file needs
  `--input-type json` (sops infers the store from the extension).
- The dev app's `rt` wrapper runs from the main repo-tools checkout: whatever
  branch that checkout has is what `rt` and a restarted daemon run.
- Settings are boot-read in deck/board — a store change needs an app restart;
  the config-file watchers do not see store edits.
- **A raw `readStore(...).global[key]` never sees `key@N`.** `identity.ts`,
  `lib/team/members.ts`, `lib/team/invite.ts` and `commands/team.ts` read
  their keys that way; move such a reader to `readSection` (or the
  resolver) before its key's `storeVersion` goes above 1.
- **Do not run `rt settings migrate --write` before the apps' rt-client
  moves.** Writing `key@N` starts divergence for every writer still on the
  old name.

## Per-app key tables

The authoritative per-app tables (which key, which scope, what shape) are in
`docs/superpowers/specs/2026-08-20-suite-settings-migration.md`; app-facing
summaries live in each app's README (gitq, board) and
`~/.mattstack/work/scratch/handoff-2026-08-21-deck-state-for-react-rewrite.md`
for deck.

For what each key resolves to on a NEW teammate's machine the moment Install
finishes ... who writes it, whether it travels with the team store, and what
is still missing ... see
[the day-one audit](superpowers/specs/2026-09-03-day-one-settings-audit-design.md).
