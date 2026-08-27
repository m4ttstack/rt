# mattstack app launcher: a deck-backed app registry and a shared launcher component

Date: 2026-08-27. Status: approved design, awaiting spec review then implementation plan.

Cross-repo feature spanning **deck** (`~/Documents/GitHub/deck`) and
**app-kit** (`~/Documents/GitHub/app-kit`, `@mattstack/app-kit`), plus a small
manifest file in each consuming app.

## Problem

The mattstack apps each live at their own deck domain (`chat.mattstack`,
`board.mattstack`, `console.mattstack`) with no way to move between them. There
is no cross-app navigation and no single place an app can discover the others.
app-kit already unifies the apps' UI DNA (shared shell, components, server
frame), which makes a shared, once-built launcher feasible; what is missing is
the registry behind it.

## Goal

1. Make deck the registry of record for mattstack apps' discovery metadata
   (display name, icon, description) on top of what it already tracks (name,
   URL, managed-by).
2. Expose that as a small, browser-facing discovery API.
3. Ship a single `<AppLauncher />` React component from app-kit that any
   mattstack app mounts to get a Google-style app-grid switcher, fed by that
   API, with zero per-app wiring beyond a manifest.

## Non-goals

- Changing deck's existing `/api/v1` board API, supervision, domains, or
  publishing. This adds alongside them.
- A public/internet-facing registry. Discovery is over the local deck surface
  (`deck.mattstack` / `deck.localhost`); it inherits deck's existing exposure
  rules.
- Folding chat into console, or removing any app's own domain. The launcher
  makes the apps discoverable while they stay separate deploys. (See
  `project-mattstack-app-discoverability` memory for that tabled thread.)
- A `create-mattstack-app` scaffolder (separate follow-up).

## What already exists in deck (verified 2026-08-27)

The design builds on deck's current shape rather than adding a new subsystem:

- deck runs an HTTP API on port 11007, served at `deck.localhost` /
  `deck.mattstack` (the "board"), with a versioned REST surface:
  `GET /api/v1/apps`, `POST /api/v1/apps`, `DELETE /api/v1/apps/:name`,
  and per-app `restart/logs/override/publish/password/access/adopt`.
- `GET /api/v1/apps` returns a `StatusRow` per app that ALREADY carries a
  resolved `url` (`<name>.mattstack` for managed products, `<name>.localhost`
  for user apps, the tunnel domain when public) and `port`/`published`/health.
- The registry record (`src/registry/records.ts`, `AppRecord`) has
  `name`, `managedBy` (`user` | `deck` | a manager id such as `rt`), `port`,
  `kind` (`service` | `external`), `command?`, `label?`. deck already treats
  `managedBy !== "user"` as "a mattstack product," which is the launcher's
  filter.
- GET requests on `/api/v1` are allowed through even on a public host
  (`src/api/server.ts`), so browser reads are already permitted.
- The app record stores the app's `workingDirectory`, so deck can read files
  from the app's repo at adopt time.

The gaps this feature fills: the record has no `displayName`/`description`/
`icon`; there is no icon storage or serving; and adoption
(`deck adopt --managed-by rt`) does not ingest app-declared metadata.

## Decisions taken during brainstorming

| Question | Decision |
|---|---|
| Where app metadata + icon live, and how they reach deck | Deck-hosted, app-declared: the app declares its identity; deck stores it and serves the icon (single source, survives an app being down). |
| Manifest form + ingestion | `mattstack.json` at the app's repo root; deck reads it from `workingDirectory` at adopt time and on a refresh command. No app-side runtime code. |
| Discovery API | A new, slim `GET /api/apps` (mattstack products only), separate from the internal `/api/v1/apps`. |
| Launcher trigger icon | The shared mattstack platform mark (one icon shipped in app-kit), not the current app's own mark. |
| How the component gets the list | The component fetches deck directly; deck sends CORS headers on the two read-only discovery routes. No per-app proxy. |
| UI shape | Option B: a header-right trigger in `MattstackShell` opening a Google-style app-grid popover. |

## A. The manifest (`mattstack.json`, app repo root)

```json
{
  "displayName": "Chat",
  "description": "Group chat for the agents across the estate",
  "icon": "./public/icon.svg"
}
```

- `displayName` (required): the launcher tile label and window/switcher title.
- `description` (optional): a short one-liner; may show as a tile tooltip.
- `icon` (required): a repo-root-relative path to an SVG. SVG only for v1
  (crisp at any tile size, small, one file). A size cap (say 64 KB) is
  validated at ingest.
- `name` (the registry key) and `url` are NOT in the manifest; they come from
  deck's registry so the manifest cannot contradict deck's routing.
- Absent or invalid manifest: the app still lists, with a title derived from
  `name` and the generic mattstack fallback mark. Ingestion never fails an
  adopt; a bad manifest is logged and skipped.

## B. deck: ingestion and storage

**Record.** Extend `AppRecord` with optional `displayName?: string`,
`description?: string`, and an icon marker `icon?: { ext: "svg"; storedAt:
string }` (or a boolean plus a conventional path). Only managed apps
(`managedBy !== "user"`) carry these; user apps skip manifest ingest entirely.

**Ingest.** A new module (e.g. `src/registry/manifest.ts`) with a pure
`readManifest(dir): Manifest | null` (validate shape, size, SVG) and an
`ingestManifest(name)` that reads `<record.workingDirectory>/mattstack.json`,
copies the referenced icon to `~/.mattstack/deck/icons/<name>.svg`, and writes
`displayName`/`description`/`icon` onto the record. Pure read/validate split
from the fs-writing half so the parser is unit-testable without a real repo.
`workingDirectory` is set only for service-kind apps registered with `--dir`;
a `--port`-only app has none, so `ingestManifest` guards
`record.workingDirectory === undefined` and treats it as a skip (the mattstack
products are all supervised services, so this is the rare case, not the norm).

**When it runs.**
- At **adopt** (`/api/v1/apps/:name/adopt`, the path rt setup already calls):
  after the record is marked managed, ingest the manifest. rt's
  `deck adopt --managed-by rt` call is unchanged; deck does the ingest itself.
- A new **`deck manifest refresh <name>`** CLI verb (and
  `POST /api/v1/apps/:name/manifest/refresh`) re-reads and re-copies, so a
  display-name or icon edit propagates without re-adopting.
- Opportunistically on **restart** of a managed app (cheap, keeps icons fresh
  after a pull). If this proves noisy, drop it and rely on the refresh verb.

**Icon store.** `~/.mattstack/deck/icons/<name>.svg`. One file per app,
overwritten on refresh, deleted when the app is removed from the registry.

## C. deck: the discovery API

Two new routes, mounted alongside the existing `/api/v1` surface, deliberately
NOT versioned under it (they are a minimal public contract, not the board's
internal API):

**`GET /api/apps`** returns mattstack products only, each as a slim discovery
row. The precise filter is `managedBy !== "user" && !isPlatformManagedBy(
managedBy)`: deck's OWN dashboard row is `managedBy: "deck"`, which is also
`!== "user"`, so the bare `!== "user"` shorthand used elsewhere in this spec
must be tightened here. The mechanism exists: `isPlatformManagedBy`
(`src/services/manager.ts`, true for `"deck"` and legacy `"local"`), or
equivalently the `StatusRow.self` flag. The row shape:

```json
{
  "apps": [
    {
      "name": "chat",
      "displayName": "Chat",
      "description": "Group chat for the agents across the estate",
      "url": "https://chat.mattstack",
      "icon": "https://deck.mattstack/api/apps/chat/icon"
    }
  ]
}
```

- `url` is deck's already-resolved app URL (reuse the `StatusRow.url`
  derivation; do not recompute).
- `icon` is an absolute URL to the icon route below. Rows with no stored icon
  get a sentinel the component renders as the fallback mark (either omit
  `icon` or point at a shared `/api/apps/_fallback/icon`).
- Excludes deck's own platform/dashboard row (the `managedBy: "deck"` / self
  row at `deck.mattstack`) and all user apps. The **board app** (`managedBy:
  "rt"`) IS included like any other product, so it is discoverable/linkable
  from the grid even though board does not itself host the launcher until it
  moves onto app-kit. Sort stable (by `displayName`, then `name`).

**`GET /api/apps/:name/icon`** streams `~/.mattstack/deck/icons/<name>.svg`
with `content-type: image/svg+xml` and cache headers; 404 (or the fallback)
when absent.

**CORS.** Both routes send `Access-Control-Allow-Origin` so an app's browser
at `chat.mattstack` can read them cross-origin. Scope the allow to the
mattstack TLDs deck already knows (`platform.json.tlds`: `localhost`,
`mattstack`) plus any bound custom domain, rather than `*`, since the value is
low-sensitivity but there is no reason to open it to the whole internet. Only
these two GET routes get CORS; the `/api/v1` surface is unchanged.

## D. app-kit: the `<AppLauncher />` component

Shipped from `@mattstack/app-kit` (the `app` subpath), mounted by
`MattstackShell` in the header's right slot (option B).

**Trigger.** The shared mattstack platform mark (a `MattstackMark` asset in
app-kit, distinct from each app's own brand mark), as an icon button. Clicking
opens a popover. The mark is **lifted from the mattstack `.app` iconset**
(traced/extracted to an inline SVG) so the launcher button matches the
installer/tray icon exactly and reads as one platform identity, rather than
being drawn fresh.

**Popover.** A Google-style grid: one tile per app from `/api/apps`, each an
icon (from the app's `icon` URL) above its `displayName`, linking to the app's
`url`. The current app is marked (a check or highlight) and/or sorted first.
Built on the kit's existing menu/popover primitives; the grid is a small new
presentational piece.

**Data.** Fetches `<deckBase>/api/apps` on open (and caches briefly).
`deckBase` is **derived from the current origin**: at `*.mattstack` it is
`https://deck.mattstack`; at `*.localhost` it is `https://deck.localhost`; a
`deckBase` prop overrides for dev or a custom domain. If the fetch fails or
returns nothing, the launcher renders nothing (or a disabled trigger) so a deck
that is down or unreachable never breaks an app's header.

**Props.**
```ts
interface AppLauncherProps {
  /** This app's deck registry name, to mark/sort "you are here". Optional. */
  currentApp?: string;
  /** Override the derived deck base URL (dev, custom domain). Optional. */
  deckBase?: string;
}
```

**Shell wiring.** `MattstackShell` renders `<AppLauncher currentApp={...} />`
in the header when the app passes its name (a new `appName` prop on the shell,
or the launcher is opt-in via a shell slot). Absent that, no launcher. This is
the once-built payoff: every app on app-kit gets the launcher by adding its
name and a `mattstack.json`.

**Navigation.** Tiles are plain anchors to the other app's `url` (full
navigation to that domain), same tab by default.

## E. Data flow

```
app repo: mattstack.json (+ icon.svg)
        │  (deck reads at adopt / manifest refresh)
        ▼
deck registry: AppRecord{ ...displayName, description, icon }  +  ~/.mattstack/deck/icons/<name>.svg
        │  GET /api/apps  (CORS)          │  GET /api/apps/:name/icon  (CORS)
        ▼                                  ▼
app-kit <AppLauncher/> in chat/console browser
        │  renders the grid, tiles link to each app's url
        ▼
user clicks a tile -> navigates to that app's domain
```

## F. Scope and execution order (across repos)

1. **deck** (lands first; the component depends on it): `AppRecord` fields,
   `manifest.ts` (read/validate/ingest), adopt + `deck manifest refresh`,
   `GET /api/apps`, `GET /api/apps/:name/icon`, CORS, the icon store, tests.
   Docs-only-adjacent: this is real service code, so it ships through deck's
   normal flow, not straight to main.
2. **app-kit**: the `MattstackMark` asset, `<AppLauncher />`, the grid popover,
   `MattstackShell` wiring, tests. A new package export if needed. NOTE: the
   app-kit source this depends on (`MattstackShell`, `HybridMenu`, the `core`
   and `app` subpaths) currently lives on the unmerged `feat/packages` branch,
   not `main`; the app-kit plan targets a MERGED app-kit. `MattstackShell`'s
   header today is just `<Group>{mark}{name}</Group>` with no right-hand slot,
   so mounting the launcher is genuinely new header wiring (the `appName` prop
   plus a right slot), not a drop-in.
3. **consuming apps**: add `mattstack.json` + an `icon.svg` to chat and
   console (and board if it should appear, even if board does not itself show
   the launcher). Then re-adopt or `deck manifest refresh` each.

These are separate plans in dependency order; deck first, then app-kit, then
the per-app manifests. This feature is the prerequisite integration before the
existing-app migrations onto app-kit.

## G. Testing

- **deck**: `readManifest` unit tests (valid, missing, oversized, non-SVG,
  bad JSON); `ingestManifest` against a temp repo dir (icon copied, record
  updated, user apps skipped); `GET /api/apps` shape + mattstack-only filter +
  fallback row; `GET /api/apps/:name/icon` content-type + 404; CORS headers
  present on both and absent elsewhere; refresh re-copies a changed icon.
- **app-kit**: `<AppLauncher>` renders the grid from a mocked `/api/apps`,
  tiles link to the right urls, current app is marked, an empty/failed fetch
  renders nothing (never throws), `deckBase` derivation from origin with the
  prop override.
- **manual**: with chat + console adopted and manifests in place, the launcher
  in each shows both apps with correct icons and cross-links.

## H. Resolved decisions (from spec review)

- **Board appears as a launcher tile** (it is `managedBy: "rt"`, so it lists
  once it ships a `mattstack.json`); deck's own dashboard row is excluded.
  Board does not host the launcher itself until it moves onto app-kit.
- **SVG only for v1.** PNG is a later addition only if some app cannot ship an
  SVG mark; not built now.
- **The shared `MattstackMark` is lifted from the mattstack `.app` iconset**,
  not authored fresh, so the platform mark and the installer/tray icon stay
  identical.

Remaining implementer choice (not blocking): the exact home for the launcher
in the shell header (a dedicated right slot vs the shell rendering it whenever
the app passes its `appName`).
