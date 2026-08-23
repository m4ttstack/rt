# mattstack-console

Scaffolded from the mantine-kit template: Mantine 9, React 19, Vite, and Bun, with a `@ui/*`
wrapper kit layered on top.

## Quickstart

```bash
bun install
bun run dev
```

## Scripts

| Script                    | What it does                                                               |
| ------------------------- | -------------------------------------------------------------------------- |
| `bun run dev`             | Start the Vite dev server.                                                 |
| `bun run test`            | Run the test suite (Vitest). Add `-- --run` for a single non-watch run.    |
| `bun run lint`            | ESLint over `src` and `.storybook`.                                        |
| `bun run typecheck`       | `tsc -b` project-references typecheck, no emit.                            |
| `bun run build`           | Typecheck (`tsc -b`) then production build (`vite build`).                 |
| `bun run build-storybook` | Build the static Storybook site.                                           |
| `bun run storybook`       | Run Storybook locally in dev mode (port 6006).                             |
| `bun run format`          | Format the repo with Prettier (`--write`).                                 |
| `bun run format:check`    | Check formatting without writing (what CI runs).                           |
| `bun run debrand`         | Guard against leftover source-project naming (`scripts/debrand-check.sh`). |
| `bun run preview`         | Preview the production build locally.                                      |

## Learn more

- The app ships its own docs: run `bun run dev` and open `/docs` for per-topic guides — theming
  and the layered backgrounds, hooks, modals, notifications, forms, the components catalog, icons,
  and the **App chrome** guide (the `RailShell` + `PageShell` double-nav recipe this site's docs
  and demo sections run on).
- `AGENTS.md` — the kit's conventions: import walls, adding components, the icon registry, theme
  overrides, facade usage (modals, notifications, forms), storage and color-scheme hooks, and the
  boot family.
- `bun run storybook` — a story for every kit component, including a searchable icon-registry
  gallery.
