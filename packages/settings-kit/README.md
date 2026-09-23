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
`POST {base}/set`, `POST {base}/unset`. Writes are refused for non-local
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

## Shapes

```ts
import { SHAPES, rowKind, summarize, targetScope, matchesShape } from "@mattstack/settings-kit/shapes";
```

Headless declarations for composite keys (`stringList`, `pairList`,
`stringMap`, `leaves`, and `external` for editors another app owns) plus
the helpers a settings UI needs: `rowKind` picks a control, `summarize`
gives the collapsed line, `targetScope` says where an edit lands (the
winning layer when allowed, else the key's first scope). A deep-merged
`leaves` row counts only fields some store layer sets (`effective.authored`),
so a registry default alone reads as "0 of N set".

Pass `allowComposite: "shaped"` to `settingsHandler` to admit composite
writes only for keys `SHAPES` declares, and only with a matching value;
`external` keys are never admitted. `allowComposite: true` admits every
composite as a whole-JSON replacement. Writes also require an
`application/json` body (415 otherwise).

For a deep-merged key, `effective.value` is the merged view, not any one
store's contents. Build a leaf edit from the target scope's authored row
from `explain`, as `move` does, never from `effective.value`, or the write
bakes the default and weaker layers into the target store.

`useSettingsScope(...).move(key, from, to)` moves the source layer's
authored value to another scope, then clears the source. For a deep-merged
key it merges into the target's own authored value in precedence order, so
the effective value does not change unless a populated layer sits between
the two.
