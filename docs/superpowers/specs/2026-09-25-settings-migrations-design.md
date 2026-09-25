# Settings migrations and schema drift (spec 3 of 3)

**Status:** approved in brainstorming, 2026-09-25; revised after review rounds 1
to 5 (the floor rule was dropped for versioned store names; divergence is judged
against a per-name baseline)
**Repo:** rt (`packages/rt-client`, `packages/settings-kit`, the `rt settings`
verbs, the release flow)
**Depends on:** spec 1 (registry schemas, `storeVersion`, `validateWrite`, the lock
file and the breaking-change classifier)
**Sibling:** spec 2, console JSON editors (apps), independent of this one

## Why

Spec 1 gives every JSON key a versioned schema and blocks a breaking schema change
until it is acknowledged. That stops accidents, but a key still cannot change shape
without every user hand-editing their stores. This spec lets a key's shape change
between releases: the change is detected automatically, a migration is drafted where
the change is mechanical, the migration is proven against sample values, and stored
values are carried forward.

Readers are not one thing. Every rt CLI, daemon, app and the VS Code extension
resolves settings through its own bundled `@mattstack/rt-client`; the apps repo pins
its rt-client in its catalog and moves it by PR, so the daemon and the apps run
different rt-clients for days at a time; the user store syncs to Matt's other
machines; the team store is shared with teammates on whatever rt they have. There
is no reliable way to know the oldest reader or writer of a store. So the design
never changes a value's shape in place: a breaking change gets a new store name, an
old reader keeps reading the old one, and the one hazard that remains (an old writer
touching an old name after the new one exists) is detected against a recorded
baseline and reported rather than guessed at.

## Goals

1. A key's shape can change between releases with a registered, tested migration.
2. A breaking schema change with no migration cannot merge or release.
3. Mechanical changes get their migration drafted by a tool.
4. New readers always get the current shape, whatever a store holds.
5. An old reader never misreads: it sees at worst a frozen value, never a new shape.
6. An edit made through an old name after the new one exists is detected, and
   nothing deletes it silently.
7. Rewriting stores is explicit, additive and reversible; deleting old names is a
   separate, deliberate step.

## Non-goals

- Strict reads (a separate later decision, per spec 1).
- Value-level migrations of scalar keys (key renames and retirements cover them).
- Knowing or enforcing which rt-client versions read or write a store. No floors, no
  discovery through deck.

## Design

### Store names carry the version

- Spec 1's `storeVersion` on the def (default 1) picks the **store name** of a key:
  `key` for version 1 and `${key}@${storeVersion}` above it, for example
  `rt.notify.eventBridges@2`. Code keeps using the plain key (`getSetting`,
  `rt settings set`, `/set`); only the property name in the store files changes.
- `storeVersion` goes up exactly when a key's schema changes in a breaking way
  (spec 1's classifier). A safe change keeps the name.
- Store names are ordinary JSON properties: writes go through the same
  `modify(content, [name], ...)` path (or `["repos", identity, name]`) as today,
  and reads are plain `section[name]` lookups. Two places do need to recognize the
  `@N` suffix, and a planner should expect them: the unregistered-key listing
  (to report `key@N` above the reader's version as "newer than this rt" rather than
  as a stray key), and the prune delete, which removes an older name directly
  (`unsetSetting` looks names up in the registry and would refuse `key@N`).

### Store metadata

- Each section (global, and each `repos.<identity>`) may hold one metadata
  property, `$migrated: { [older store name]: <hash> }`: for each older name that
  was present when the current name was first written into that section, the hash
  of its authored value at that moment. Hashes are of the canonical JSON of the
  authored value. Older names are unique strings (`rt.roles`, `rt.roles@2`, a
  `renamedFrom` key's names), so one flat map covers every older name of every key.
- rt treats `$`-prefixed names as store metadata: it never resolves them as keys and
  never reports them as unregistered (one condition in the unregistered-name scan,
  for the global section and each repo section). An older rt-client reports
  `$migrated` with its usual unknown-key warning and ignores it, exactly as it does
  `key@N`.

### Migrations on the def

- `migrateFrom?: { version: number; schema: z.ZodType; up: (value: unknown) =>
  unknown }[]`: one entry per older version still readable, each carrying that
  version's schema (for proof tests and the acceptance check) and a pure,
  synchronous `up` to the next version. The chain must be unbroken from the oldest
  entry to `storeVersion`; a registry test fails on a gap, an overlap or a backwards
  step. For deep-merge keys `up` receives one layer (partial) and must keep it
  partial.
- `renamedFrom?: string[]` on a def reads an old key's store names as older versions
  of the new key (the old key's `migrateFrom` chain continues into the new key's).
  Retiring a key keeps using `RETIRED_KEYS`.

### Reading: newest name wins, older names migrate in memory

- In each section, the resolver looks for the current store name first. If absent,
  it takes the highest older name present (`key@N` down to `key`, then any
  `renamedFrom` names) and runs the chain from that version up, before labeling and
  merge. New readers always receive the current shape.
- If the current name is present, every older name present in the same section is
  judged on its own and gets one of three labels:
  - `leftover`: its migrated value equals the current value;
  - `stale`: it differs, and `$migrated` holds a baseline for that name whose hash
    matches its authored value (it has not changed since the current name was
    written);
  - `diverged`: it differs, and either `$migrated` has no baseline for that name
    (it was created after the current name, since any current-version writer that
    found it would have recorded one) or the hash no longer matches (it was edited
    after). The label carries that name's migrated value and the current value.
  The layer's label is the worst of its older names' labels (`diverged` over
  `stale` over `leftover`), and explain rows list each older name with its own.
- A step that throws, or a result that fails the schema, leaves that layer labeled
  `nonconforming` with the step named, and the layer's value stays in effect as
  stored (spec 1's lenient-read rule).
- Explain rows (and settings-kit's wire rows) carry `storeName`, `storedVersion`,
  the migrated `value`, `authored` (the value as stored) and, per older name, its
  label and values. Editors start from the migrated value (spec 2).
- A name `key@N` with `N` above the reader's `storeVersion` is reported like an
  unknown key today ("this rt may be older than the store") and skipped; the reader
  falls back to the highest name it knows. Names at or below `storeVersion` are
  never reported as unregistered.

### Writing: always the current name, never in place

- Every write of a key, by anything on the current rt-client, goes to the current
  store name. Older names in that section are left exactly as they were.
- When that write is the first to put the current name into a section, the writer
  also records a baseline in `$migrated` for every older name of that key present in
  the section, in the same `modify` batch. A baseline is recorded only for a name
  that has none: a name already `diverged` from an earlier bump keeps its old
  baseline and stays `diverged`. Later writes leave `$migrated` alone.
- This does not close the read-then-write gap `setSetting` has today: an old writer
  that lands between the read and the batched write can still lose its edit, exactly
  as it could before this spec. The baseline detects divergence; it is not a lock.
- So an old rt-client reads the old name, frozen at its last write, and never sees a
  shape it does not know. Its unknown-name warnings for `key@N` and `$migrated` are
  the same one it prints today for any newer key.

### Divergence: an old writer after the new name exists

Once anything has written `key@N` in a section, an older writer still writes `key`
there, and new readers (which prefer `key@N`) do not see those edits; likewise the
old writer never sees edits to `key@N`. This happens on Matt's own machine whenever
rt moves ahead of the apps' rt-client pin (an older console bundle's boot-time
`reconcileEventBridgeRule` writes `rt.notify.eventBridges`, or recreates it when it
finds it missing, while a newer daemon reads `rt.notify.eventBridges@2`), on
another machine sharing the synced user store, and on the team store whenever a
teammate on an older rt edits a bumped key.

- Nothing in this spec prevents it, because nothing can know every writer. The
  baseline makes it visible and keeps it from being deleted unnoticed:
  - the resolver labels the older name `diverged` with both values;
  - `rt settings check` lists every diverged name with both values and exits 1
    (`stale` and `leftover` names are listed for information and do not fail it);
  - settings-kit's `issues[]` (spec 1) gains `kind: "diverged"` with both values
    and the older store name, so console's Needs fixing shows it and Fix lets the
    user keep either value and remove the older name (spec 2); `stale` and
    `leftover` are not issues;
  - pruning refuses a diverged name unless forced.
- The window is kept short by process, not code: a release whose lock file shows a
  `storeVersion` bump lists the keys in its release notes, and the apps repo's
  rt-client bump PR follows in the same release train. `rt settings migrate --write`
  is not run before the apps have moved, because materializing `key@N` is what
  starts the divergence for writers still on the old name.

### `rt settings migrate`

- Dry run by default: for every section of every store, lists each key whose
  current name is absent but an older name is present, with the migrated value it
  would write; and each older name beside a current one with its label
  (`leftover`, `stale`, `diverged`, the last with both values).
- `--write` writes the current name from the migrated value wherever it is absent,
  recording baselines as any first write does. This is additive (old names stay),
  so it is safe for every reader, and it can run on any store including the team
  store. It goes through the ordinary write path, so the home-snapshot daemon commits
  it like any other settings change and the snapshot repo's history is the undo.
- `--prune` deletes older names labeled `leftover` or `stale` whose current name is
  present, each with its `$migrated` entry. It never runs by default: it prints,
  per store, the names it would delete and the `storeVersion` of each key that every
  reader of that store must know, and asks for confirmation naming the store. It
  refuses the team store unless `--team` is also given, and refuses a `diverged`
  name unless `--force <key>` is given, in which case the current value stays and
  the older value is printed before deletion. It deletes through `pruneStoreName`,
  its own path, not `unsetSetting`. A name an old writer recreates after a prune has
  no baseline and reads `diverged` again, which is the intended outcome.

### settings-kit

- Wire rows and `issues[]` carry the fields named above (`storeName`,
  `storedVersion`, `value`, `authored`, per-older-name labels; `kind: "diverged"`
  with the older store name and both values).
- `POST {base}/prune` with `{ key, scope, repo?, storeName, force? }` deletes one
  older name and its `$migrated` entry through `pruneStoreName`, under the same
  local-only gate as `/set`; it refuses a `diverged` name unless `force: true`, and
  refuses a name that is not an older name of `key` or whose current name is absent.
  This is what spec 2's "Remove the older name" action calls.

### Drift detection, extended

Spec 1's classifier and lock file stay. This spec changes what makes a breaking
change acceptable and adds drafting and proof:

- **Acceptance rule (CI, against `main`):** a breaking change to a key passes only
  when the key's `storeVersion` went up by one and `migrateFrom` has an entry for
  the previous version whose `schema`, converted with `z.toJSONSchema`, shows no
  classifier-visible difference from the lock file's schema for that key on `main`
  (annotations ignored; `enum: [x]` and `const: x` are the same). Spec 1's
  acknowledged-with-a-reason escape hatch remains only for a key that has never
  shipped.
- **Acceptance rule (pre-release, against the previous tag):** the chain must cover
  every version from the tag's `storeVersion` to the current one. The entry for the
  tag's version is compared to the tag's lock file as above; later entries (versions
  that never reached a tag) are checked only by the proof below, since no lock
  exists for them.
- **Drafting:** `rt settings schema diff --draft` compares the working registry with
  the lock file and writes a `migrateFrom` entry next to the def: the previous
  version number, the previous schema (as a zod expression reconstructed from the
  lock file's JSON Schema, hand-checked in review), and an `up` stub:

  | Change | Drafted `up` |
  |---|---|
  | new required property that has a default | set the default |
  | property removed | delete it |
  | one property removed and one of the same type added in the same object | rename (flagged for confirmation) |
  | key renamed (old key retired, new key with an equal schema) | `renamedFrom` entry, no `up` |
  | enum value removed, type narrowed, anything else | stub that throws `TODO`; the check stays red until it is written |

- **Proof:** for every `migrateFrom` entry, a test generates sample values that pass
  the entry's schema using a generator over spec 1's keyword set (for deep-merge
  keys, also samples of the entry's layer schema, its full schema with `required`
  dropped as spec 1 derives it), adds the key's saved examples, runs `up` through
  the rest of the chain, and requires every result to pass the current schema (the
  layer schema for layer samples). A present but wrong migration fails CI.
- **Real stores before release:** the `rt:release` flow runs the candidate build's
  `rt settings check` (from the release checkout, so it uses the candidate's
  registry and migrations) read-only against Matt's real user, team and machine
  stores, and stops on any value that fails after in-memory migration or any
  `diverged` name. It then writes the bumped keys into the release notes.

## Testing

- Chain tests: gaps, overlaps and backwards steps are rejected; a value under each
  older name migrates to current; a deep layer stays partial; `renamedFrom` names
  continue the chain.
- Resolver tests: with the current name present, each older name is labeled
  `leftover` (equal), `stale` (baseline present and matching) or `diverged`
  (no baseline, or baseline mismatched), both values carried; two older names get
  independent labels and the layer takes the worst; a failing step labels the layer
  and keeps the stored value in effect; a name above the reader's `storeVersion` is
  skipped with the newer-store message; `$migrated` is never resolved or reported,
  in the global section or a repo section; explain rows carry `storeName`,
  `storedVersion`, `value`, `authored` and per-name labels.
- Write tests: every write lands on the current name and leaves older names
  untouched, globally and in repo sections; the first write of a current name
  records a baseline for every older name present, in the same batch; later writes
  do not touch `$migrated`; a first write with no older name records nothing.
- `migrate` tests: dry run changes nothing; `--write` adds current names and
  baselines only; `--prune` refuses without confirmation, refuses the team store
  without `--team`, refuses a diverged name without `--force <key>`, removes the
  `$migrated` entry with the name, and deletes through `pruneStoreName`; a name
  recreated after a prune reads `diverged`.
- `check` tests: diverged names listed with values and exit 1; stale and leftover
  listed with exit 0.
- settings-kit tests: `/prune` deletes an older name and its baseline, refuses
  diverged without `force`, refuses a non-older name, and is local-only.
- Drafting tests: one per row of the drafting table.
- Proof tests: a deliberately wrong migration fails; a correct one passes over full
  and layer samples.
- Classifier acceptance: a breaking change with no `migrateFrom` fails; with an
  entry whose schema differs classifier-visibly from the previous lock it fails;
  with an `enum`/`const` round-trip difference only, it passes; the pre-release
  check accepts a chain spanning two bumps since the tag.

## Acceptance

- Renaming a property on `rt.notify.eventBridges` in a PR fails CI until
  `storeVersion` is 2 and a `migrateFrom` entry for version 1 exists; `--draft`
  proposes the rename; with it filled in, CI passes.
- After the release, a store still holding `rt.notify.eventBridges` (version 1) is
  read in the new shape with no manual step; a console edit writes
  `rt.notify.eventBridges@2`, records the old name's baseline, and leaves the old
  name as it was; the old name then reads `stale`, and `rt settings check` still
  exits 0.
- A teammate on the previous rt keeps reading the old name and sees only the
  familiar unknown-key warnings for the new name and `$migrated`; if they edit it,
  or create it where it was absent, `rt settings check` reports it as `diverged`
  with both values, and pruning refuses it.
- `rt settings migrate --write` adds current names everywhere they are absent;
  `--prune` removes leftover and stale names, after confirmation.
- The pre-release check stops on a real stored value the migration fails to carry.
