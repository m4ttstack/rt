# Stories

Root-level stories that span packages. `ramps/` is the tokens reference
catalogue: it renders `packages/tokens` values directly, both schemes side
by side, with contrast computed at render time. `specimens/` renders real
tui-kit and app-kit components on the emitted tokens and fails the a11y
addon on any violation; use the Scheme toolbar to switch.

`bun run tui-kit:build` must run before `bun run storybook` or
`bun run build-storybook`; the provider import resolves to `dist/`.
