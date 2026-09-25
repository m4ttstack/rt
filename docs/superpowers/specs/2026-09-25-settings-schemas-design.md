# Settings schemas and validation (spec 1 of 3)

**Status:** approved in brainstorming, 2026-09-25; revised after review round 1
**Repo:** rt (`packages/rt-client`, `packages/settings-kit`)
**Followed by:** spec 2, console JSON editors, per-repo view and fix flow (apps
repo); spec 3, settings migrations (rt)

## Why

55 of the 103 registered settings keys hold JSON (objects or arrays). The registry's
`validateValue` checks only the top-level type plus the path-literal guard, so any
object passes for any object key. Console can edit 24 of those keys (the settings-kit
`SHAPES` entries other than the 3 `external` ones); the other 28 have no editor, and
they are the riskiest (`rt.notify.eventBridges`, `rt.intercepts`, `rt.roles`,
`deck.apps`, `rt.hooks`, and so on). A malformed value in any of them breaks an app
with no error at the point of the write.

This spec gives every JSON key a real schema, owned by the registry, so every writer
refuses a bad value the same way, and gives specs 2 and 3 one source of truth for a
key's shape. It also carries the settings-kit wire additions spec 2 needs.

## Goals

1. Every composite key (type `object` or `array`) has a schema that describes what
   the code reading it already accepts.
2. Writes are validated against it everywhere; reads never change behavior.
3. The schema, its display metadata and every layer's issues reach the browser.
4. settings-kit's `SHAPES` table stops being a second source of truth.
5. A schema change that could invalidate stored values cannot merge or release
   unnoticed.
6. settings-kit can resolve for a chosen repo, so per-repo values become visible.

## Non-goals

- Console UI (spec 2).
- Migrating stored values between schema versions (spec 3). This spec only reserves
  the version field and blocks breaking changes.
- Schemas for scalar keys beyond what exists (their type and `ENUMS` cover them).

## Design

### Schemas in the registry

- `SettingDef` gains `schema?: z.ZodType` (zod v4). Every def with type `object` or
  `array` must have one; a registry test fails otherwise.
- `SettingDef` gains `storeVersion?: number`, default 1. Spec 3 gives it meaning
  (above 1, the key's store name carries it, `key@2`); this spec only records it in
  the lock file.
- The schema describes the value a reader receives: the fully resolved value (after
  deep merge, for `merge: "deep"` keys). The code that reads a composite key uses
  `z.infer<typeof schema>` as its type, so the type and the check cannot drift.
- Schemas allow unknown extra properties (`z.looseObject`) unless a key genuinely
  rejects them, which it states with `z.strictObject`. They describe what readers
  accept, not an ideal.
- Display metadata that `SHAPES` carried today moves onto the schema with zod
  `.meta()`, which `z.toJSONSchema` carries into the JSON Schema:
  - `labels: { key, value }` on a record (for example `rt.repoIdentityOverrides`:
    "remote URL" / "identity");
  - `placeholder` on a property (for example `board.slack`'s emoji fallbacks);
  - `title` and `description` on properties where the property name is not enough.
- zod becomes a dependency of `@mattstack/rt-client`, chosen for `z.infer` plus its
  built-in `z.toJSONSchema`, which spares a second hand-written JSON Schema per key.

### Deep-merge keys: layers are partial

32 of the 55 composite keys merge deep, and each layer holds only the fields it sets
(a machine layer of `rt.homeSnapshot` may set only `enabled`). So:

- A layer is checked against the key's **layer schema**: the schema with every
  object property made optional, recursively through nested objects and record
  values. Array items stay whole, because deep merge replaces arrays atomically.
- The layer schema is derived from the key's JSON Schema, not from zod (zod v4 has
  no deep-partial): drop `required` at every object level except inside `items` and
  `prefixItems`. Server and browser check layers with the same JSON Schema
  validator (`@cfworker/json-schema`); zod's `safeParse` is used only for full-schema
  checks (replace-merge layers and merged results).
- A write also checks the **merged result** (that layer plus every other layer, as
  the resolver would merge it) against the full schema, and is refused only if the
  merged result fails where it passed before the write, so a broken layer elsewhere
  never blocks an unrelated edit. For a global write of a repo-scoped key the check
  runs once with no repo and once per repo that has a section in any store, since
  the global layer feeds every one of those merges.
- Replace-merge keys (`merge: "replace"`) check each layer against the full schema.

### Strict on write, lenient on read

- `validateValue(def, value)` is unchanged: type check and path guard. It stays the
  resolver's skip rule, so reads cannot start skipping values.
- A new `checkSchema(def, value, { layer: boolean })` returns every schema issue
  (`{ path: (string | number)[], message }[]`) against the layer schema or the full
  schema. The resolver calls it only to label.
- A new `validateWrite(def, value, { scope, repoIdentity? })` is the one write gate:
  `validateValue`, then `checkSchema` on the layer, then the merged-result check.
  Its failure reason names the first failing path (`[0].pattern: expected string`);
  zod reports issues in declaration order, so each schema declares its most
  important properties first.
- Every write path (`setSetting`, `rt settings set`, settings-kit `/set`, daemon
  verbs that write settings) calls `validateWrite` and refuses on failure.
- The resolver's read path does **not** skip a value that fails only the schema. It
  keeps the value in effect and labels the row `nonconforming` (with the issues) in
  `explain` and `list`. A value that fails the existing type check or path guard is
  still skipped as today (`invalid`). A merged value that fails the full schema is
  labeled on the def (`mergedIssues`).
- Read strictness is out of scope; that decision comes later, once audits stay clean
  across several releases.

### JSON Schema conversion

- `z.toJSONSchema(schema, { io: "input" })`, so a property with a `.default()` is
  optional and a `looseObject` allows extras, exactly as `safeParse` behaves. The
  browser check and the server check therefore agree.
- The layer schema is converted the same way and sent alongside
  (`layerSchema`) for deep keys.

### settings-kit

- `SettingDefWire` gains:
  - `schema?: JSONSchema`, `layerSchema?: JSONSchema` (deep keys),
    `storeVersion?: number`;
  - `issues?: { scope, file, repo?, kind, path, message, ...extra }[]`: every
    layer's problems, so a list page needs no per-key explain call. `kind` is an
    open string; this spec emits `"invalid"` and `"nonconforming"`, and spec 3 adds
    `"diverged"` (carrying the older store name and both values). Spec 3's other
    labels (`stale`, `leftover`) appear on explain rows only, never in `issues[]`.
    Consumers show unknown kinds generically;
  - `mergedIssues?: { path, message }[]`;
  - for repo-scoped keys, `repos?: { identity: string; scopes: string[] }[]`: which
    repos set the key in which stores.
- The `/defs` response gains `unregistered: { key, scope, file }[]`, the
  unregistered keys found in stores (what `listSettings` already reports).
- Explain rows gain `nonconforming?: { path, message }[]`.
- `/defs` and `/explain/:key` accept `?repo=<identity>`; with it, repo-scoped keys
  resolve for that repo (the resolver's `repoIdentity`) and their repo rungs
  (`team.repo`, `user.repo`, `machine.repo`) appear in explain rows and in `issues`.
  `/set` and `/unset` accept `repo` in the body and write that repo's section.
- `GET {base}/repos` lists repo identities: every identity with a `repos.<id>`
  section in any store, plus the repos rt knows, each with a display label.
- `/set` calls `validateWrite` instead of `validateValue`. The
  `allowComposite: "shaped"` gate admits every composite key that has a schema and is
  not `external`.
- `SHAPES` shrinks to the `external` marker (`board.members`, `board.tabs`,
  `board.hiddenMembers`, which board edits in its own UI). `stringList`, `stringMap`
  and `leaves` become pattern recognizers over the JSON Schema:
  `recognize(schema) → { kind: 'stringList' | 'stringMap' | 'leaves' | 'objectList' |
  'objectMap' | 'json', labels?, placeholders? }`. `rowKind`, `summarize`,
  `matchesShape` and `targetScope` keep their exported names and read the schema.
- settings-kit exports `checkValue(schema, value)` for browser-side checks, built on
  `@cfworker/json-schema` (small, no `eval`, CSP-safe), returning the same
  `{ path, message }[]` shape as `checkSchema`. It checks the one value it is given;
  the merged-result check stays server-side.
- Release: settings-kit minor bump; board, console and boxscore move with it in
  spec 2.

### `rt settings check`

- Lists every stored value in the user, team and machine stores, global and
  per-repo sections, that fails its layer schema or its type check, and every merged
  value that fails the full schema, with key, scope, file, repo and each issue.
  Also lists unregistered keys found in stores. Exit code 1 when anything fails.
- It uses the registry of the rt that runs it. `--json` for scripts. Read-only.

### Schema lock file and drift check

- `packages/rt-client/settings-schema.lock.json` is generated from the registry:
  `{ [key]: { storeVersion, schema } }` (JSON Schema, `io: "input"`), sorted,
  committed. `rt settings schema lock` regenerates it.
- A classifier compares two lock files key by key. It understands this keyword set:
  `type`, `properties`, `required`, `additionalProperties`, `propertyNames`, `items`,
  `prefixItems`, `enum`, `const`, `anyOf`, `oneOf`, `minimum`, `maximum`,
  `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `minItems`,
  `maxItems`, `pattern`, `format`; it ignores annotations (`default`, `$schema`,
  `title`, `description`, and the `.meta()` keys).
  - **Safe:** a key added; an optional property added; a type widened; an enum value
    or `anyOf`/`oneOf` branch added; a limit loosened or removed; `pattern` or
    `format` removed; `additionalProperties` loosened.
  - **Breaking:** a key removed; a property removed when extras are not allowed; a
    property made required; a type narrowed or changed; an enum value or branch
    removed; a limit added or tightened; `pattern` or `format` added or changed;
    `additionalProperties` tightened; `propertyNames` or `prefixItems` changed.
  - A keyword outside the set is fine while unchanged; any change to one counts as
    breaking so a human looks.
  - Adding a typed optional property is safe for the schema but can collide with a
    stored extra of the same name and a different type (loose objects allow extras).
    The classifier cannot see stores, so `rt settings check` before release is what
    catches it.
  - For deep-merge keys the classifier compares the full schemas; a layer never has
    required properties, so "made required" concerns only the merged value.
- CI (rt, on every PR): regenerate the lock and fail if it differs from the committed
  one (stale lock). Then classify the committed lock against the one on `main`; any
  breaking change fails unless that key's `storeVersion` went up **and** the key is
  listed in `breakingSchemaChanges` (a file next to the registry) with a one-line
  reason. Spec 3 replaces that escape hatch with "a migration is registered".
- Pre-release (the `rt:release` flow): the same classification against the lock file
  at the previous release tag, so a series of individually acknowledged changes is
  seen as a whole.

## Writing the schemas

- One schema per composite key, next to its def in `registry-defs.ts` (or a sibling
  `registry-schemas.ts` if the file grows past readability).
- Source of truth for each schema: the code that reads the key today. Where readers
  disagree, the schema follows the most permissive reader and the disagreement is
  noted in the PR.
- Keys currently shaped as `stringList`, `stringMap` or `leaves` get schemas (with
  their `labels` and `placeholder` metadata) that the recognizer maps back to the
  same kind, so console and board render them exactly as today.

## Safety: nothing breaks for anyone

- Reads keep today's behavior; a nonconforming value stays in effect and is only
  labeled.
- Teammates on an older rt keep type-only checks. New tooling writes values that
  still pass those checks, so the team store stays readable for them.
- Program writers: rt's own writers are tested in this repo against their keys'
  schemas. The apps' writers (console's bridge-rule reconcile for
  `rt.notify.eventBridges`, deck's `deck.apps`, board's writes, boxscore's
  `mattstack.roster` and `boxscore.hiddenMembers`) are tested in the apps repo in
  spec 2, against the released rt-client, before any app moves to it.
- Before release, `rt settings check` runs read-only against Matt's real user, team
  and machine stores. Any finding is fixed in the schema, not in the store.

## Testing

- Per schema: a good example (from the key's default or a real store, with invented
  data per the repo-purity rules) and at least one bad example that must fail with
  the expected path. Deep keys also get a partial layer that must pass the layer
  schema.
- Registry test: every composite def has a schema; every schema converts to JSON
  Schema; the recognizer maps every previously shaped key to its old kind with its
  old labels and placeholders.
- Resolver tests: a nonconforming stored value stays in effect and is labeled; a
  type-invalid value is still skipped; a partial deep layer is not labeled.
- Merged-result check: a write that breaks the merge is refused; a write next to an
  already broken layer is not.
- Classifier tests: one case per safe and breaking rule, an unchanged unknown
  keyword (safe) and a changed one (breaking).
- settings-kit tests: `/set` refuses a schema-invalid composite with the path in the
  error; `checkValue` and `checkSchema` agree on the same fixtures; `?repo=` adds
  repo rungs; `issues` and `repos` appear on `/defs`.

## Acceptance

- `rt settings set rt.notify.eventBridges '[{"pattern":1}]' --scope user` is
  refused, naming `[0].pattern`.
- `rt settings set rt.homeSnapshot '{"enabled":false}' --scope machine` succeeds.
- A store holding a nonconforming value resolves exactly as before, and
  `rt settings explain` labels it with the issues.
- `/defs?repo=gitlab.example.com/acme/app` shows `rt.roles` from the team store's
  repo section (fixture identity; never a real one in tests or docs).
- `rt settings check` exits 0 on Matt's stores at release time.
- A PR that makes a property required fails CI until `storeVersion` is bumped and
  the change is acknowledged.
