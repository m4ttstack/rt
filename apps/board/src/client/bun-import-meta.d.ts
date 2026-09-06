/**
 * Why this file exists — the `types: ["node"]` decision for the client project.
 *
 * `src/client/tsconfig.json` used to say `"types": ["bun"]`. Adopting the kit
 * makes the client program type-check @soribashi/factory's SOURCE (factory
 * ships `"types": "./src/index.ts"`, so its own `@ts-expect-error` suppressions
 * are re-checked under whichever consumer tsconfig pulls them in). Two of them
 * sit on `import.meta?.env`, which bun-types declares and @types/node does not
 * — so under `["bun"]` those directives become "unused" and tsc fails with two
 * TS2578s inside node_modules that no mr-board-side edit can suppress.
 *
 * The fix is to check factory the way factory's own repo checks it: tui-kit's
 * tsconfig uses `"types": ["node"]`, so the suppressions are needed and used.
 * The server project (root tsconfig) keeps `"types": ["bun"]` — it never
 * imports the kit, and it is the project that actually owns the Bun API
 * surface.
 *
 * The one Bun-ism the client program still sees is `import.meta.dir`, reached
 * through type-only imports of `src/config.ts` and `src/triage/memory.ts`.
 * Those files' real Bun typing is still enforced by the root project; this
 * declaration only keeps the client program from tripping over them.
 */
interface ImportMeta {
  /** Bun: absolute path to the directory containing this module. */
  readonly dir: string;
}
