# @mattstack/settings-kit

Embed a viewable, editable mattstack settings surface in any app. Two halves,
both thin: a framework-neutral server handler over `@mattstack/rt-client`,
and headless React hooks — you bring the UI.

## Server

Mount early in your fetch handler; `null` means "not mine, fall through":

```ts
import { settingsHandler } from "@mattstack/settings-kit/server";

// Bun.serve / hand-rolled router:
const settingsRes = await settingsHandler(req);
if (settingsRes) return settingsRes;

// Hono:
app.all("/api/settings/*", async (c) => (await settingsHandler(c.req.raw)) ?? c.notFound());
```

Routes: `GET {base}/defs?prefix=board.`, `GET {base}/explain/{key}`,
`GET {base}/repos`, `POST {base}/set`, `POST {base}/unset`. Writes are refused for non-local
Hosts by default; pass `allowWrite` with your own predicate when your server
knows the real peer address (and always when the app has any non-local
exposure). Secret keys never put values on the wire; composite
(object/array) keys are read-only by default (see `allowComposite`), and
unmigrated keys are always read-only through this surface.

## React

```tsx
import { useSettingsScope, useSettingKey } from "@mattstack/settings-kit/react";

const { defs, loading } = useSettingsScope("board.");
const key = useSettingKey("board.title");
// key.rows            — layer stack with provenance
// key.stage(scope, v) — stage an edit at one scope
// key.apply()         — write through the resolver; false + key.applyError on refusal
```

Hooks return state and actions only. Scope semantics are the resolver's:
`machine` writes apply immediately; `user`/`team` writes land in the home
repo's working copy and are local until committed and pushed.

## Schemas and editors

```ts
import { recognize, checkValue, rowKind, summarize, targetScope, SHAPES } from "@mattstack/settings-kit/shapes";
```

Every composite (object/array) def on the wire carries its JSON Schema as
`schema`, and a deep-merged object also carries `layerSchema` (the same
schema with no required properties, since one layer holds only the fields
it sets). `recognize(schema)` maps a schema to an editor kind:
`stringList`, `stringMap` (with its `labels`), `leaves` (dotted leaf fields
with their `placeholders`), `objectList`, `objectMap`, or `json` for
anything else. `rowKind` picks a control from it, `summarize` gives the
collapsed line, and `targetScope` says where an edit lands (the winning
layer when allowed, else the key's first scope). A deep-merged `leaves` row
counts only fields some store layer sets (`effective.authored`), so a
registry default alone reads as "0 of N set". `SHAPES` holds only the
`external` keys (`board.tabs`, `board.members`, `board.hiddenMembers`),
whose editor board owns.

`checkValue(schema, value)` checks one value in the browser with the same
validator and messages as the server (`[{ path: [0, "pattern"], message:
"expected string, got number" }]`); check a layer edit against
`layerSchema ?? schema`. The merged-result check stays server-side, in
`/set`.

Each `/defs` entry also carries:

- `storeVersion`;
- `issues`: every layer's problems as `{ scope, file, repo?, kind, path,
  message }`, with `kind` an open string (`"invalid"`, `"nonconforming"`;
  show an unknown kind generically). `repo` is set only on an issue from a
  repo-section rung. A secret's message never carries its value;
- `mergedIssues`: the merged value's problems against the full schema;
- `repos` (repo-scoped keys): `{ identity, scopes }[]`, which repos set the
  key in which stores.

The `/defs` response also lists `unregistered: { key, scope, file }[]`, the
keys found in stores that no registry def declares. Explain rows carry
`nonconforming` issues on a layer that fails only its schema; its value
stays in effect.

`/defs` and `/explain/{key}` take `?repo=<identity>` (the raw `host/path`
form, e.g. `gitlab.example.com/acme/app`): repo-scoped keys then resolve for
that repo and their repo rungs (`team.repo`, `user.repo`, `machine.repo`)
appear in rows and `issues`. `/set` and `/unset` take `repo` in the body
and write that repo's section. `GET {base}/repos` lists
`{ identity, label }` for every identity with a `repos.<id>` section in any
store, plus any the host passes as `rt.listRepos`.

`/set` refuses a value `validateWrite` refuses, with `{ error, issues }`
naming the first failing path. Pass `allowComposite: "shaped"` to
`settingsHandler` to admit composite writes for every key with a schema;
`external` keys are never admitted. `allowComposite: true` admits every
composite. Writes also require an `application/json` body (415 otherwise).

For a deep-merged key, `effective.value` is the merged view, not any one
store's contents. Build a leaf edit from the target scope's authored row
from `explain`, as `move` does, never from `effective.value`, or the write
bakes the default and weaker layers into the target store.

`useSettingsScope(...).move(key, from, to)` moves the source layer's
authored value to another scope, then clears the source. For a deep-merged
key it merges into the target's own authored value in precedence order, so
the effective value does not change unless a populated layer sits between
the two.
