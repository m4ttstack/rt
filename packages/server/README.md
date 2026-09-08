# @mattstack/app-server

The Hono/Bun server frame for mattstack apps: health route, JSON error
floors, static/embedded asset serving, the rt-client relay, `Bun.serve`.
Source-shipped, no build step. See the repo root `README.md` and
`AGENTS.md` for the full contract; this file is the one-screen version for
this package.

## Subpaths

Split along one rule: everything except the top-level `.` export is
vitest-safe (importable under `vitest`, never loads `hono/bun`); the
top-level export is the one module that does.

| Subpath          | Exports                                                                                                                                                                                                                                                                                 | Importable under vitest |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `./app`          | `createApp({ name, version, routes })`: mounts `/api/health` (`{ ok: true, name, version }`), `/api/daemon` (rt-client `daemonHealth`, always 200), then `routes`; JSON 404 `{ error: 'not found' }`; `onError` answers `{ error: err.message }` with the `HTTPException` status or 500 | yes                     |
| `./relays`       | `startRelays(relays, publish)`: one rt-client `createRelay` per entry; returns a single stop function                                                                                                                                                                                   | yes                     |
| `./static`       | `mountStatic(app, serveStatic, { embedded? })`: disk or embedded-manifest serving with SPA fallback; also `decideServingMode`, `loadEmbeddedManifest`, `isCompiledBinary`                                                                                                               | yes                     |
| `./event-bridge` | `ensureEventBridgeRule(read, write, rule, opts?)`: identity-aware (`pattern` + `subjectPrefix`) merge-not-clobber upsert into an `rt.notify.eventBridges`-shaped list; `deckAppUrl(name, fallback, opts?)`: an app's local url from deck's `/api/status`, falling back on any failure   | yes                     |
| `.`              | `serveMattstackApp(opts)`: `createApp` + `mountStatic` with `hono/bun`'s `serveStatic` + `/ws` upgrade + `Bun.serve({ hostname: '127.0.0.1' })` + SIGINT/SIGTERM shutdown                                                                                                               | no (`hono/bun`)         |

`bin/mattstack-embed-assets` is the CLI for a compiled-binary build: walks
`dist/`, writes an embedded manifest with `with { type: 'file' }` imports.

## Snippet

```ts
// src/server/index.ts
import { serveMattstackApp } from '@mattstack/app-server';
import pkg from '../../package.json';
import { routes } from './routes';

await serveMattstackApp({
  name: 'chat',
  version: pkg.version,
  routes,
  port: 11002, // process.env.PORT overrides; binds 127.0.0.1
  relay: [{ match: t => t.startsWith('chat/'), topic: 'chat' }],
  // embedded: () => import('./embedded/manifest'), // optional; absent = disk mode from ./dist
});
```

`routes` is the app's own `Hono` chain; `AppType = typeof routes` stays
the RPC client's typing, untouched by the frame. The error envelope is
`{ error: string }` -- an RPC client's `res.ok` check plus JSON parse both
need this shape, so a migrating app that expected a different envelope
must adjust its client's error handling.

Test the vitest-safe seams (`createApp`, `startRelays`, `mountStatic`,
`decideServingMode`) directly; `serveMattstackApp` itself is exercised by
running the built server and hitting it, the way
`probe/scripts/serve-check.sh` (`bun run probe:serve-check`) does.
