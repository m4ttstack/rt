# @mattstack/tui-kit

A React component library for terminal-flavoured web UIs: monospace type, a
graph-paper canvas, framed panels, and a Tokyo Day / Tokyo Night palette that
follows light and dark automatically. 26 components, 9 hooks, one theme, no
per-app CSS to maintain.

Built on [soribashi](https://github.com/m4ttheweric/soribashi), the
component-authoring framework that gives every component a themeable recipe, a
Styles API, and generated CSS custom properties.

tui-kit is part of the mattstack estate and is the shared look for its web
surfaces, starting with [board](../../apps/board). It is developed in this
monorepo, alongside the apps that consume it.

## Features

- **26 components** across 23 recipes: Alert, Badge, Button, Chip,
  ConfirmDialog, ContextMenu, CopyButton, Drawer, Icon, ListGroup, Markdown,
  Modal, Panel, RadioGroup, Segmented (plus LabeledSeg), SelectBox, SideDrawer,
  Spinner, StatusDot, Switch, Table, TextArea, TextField, ToastHost, Tooltip.
- **Light and dark from one theme.** Every token carries both schemes through
  `light-dark()`, driven by a `.dark` class on `<html>`. No second stylesheet,
  no per-component toggle.
- **Themeable per component.** Each component ships a `<name>Theme` entry for a
  `createTheme({ components: [...] })` call to start from, and honours the
  Styles API (`classNames`, `styles`, `unstyled`).
- **A stable CSS contract.** Short custom-property aliases (`--bg`, `--fg`,
  `--accent`) and a `data-part` attribute on every addressable element, so an
  app can style across the package boundary without reaching for hashed
  CSS-module class names.
- **9 DOM-free hooks**, each pairing a small React hook with a pure,
  independently testable function: `pushLayer`, `handleEscape`,
  `acquireScrollLock`, `releaseScrollLock`, `useRevealOnChange`,
  `useEscapeClose`, `useAutoGrowTextarea`, `useBodyScrollLock`, `useToasts`.
- **21 bundled icons** and a vendored JetBrains Mono variable font, so a
  consuming app ships no icon or font dependency of its own.
- **Verified appearance.** Every component carries committed visual baselines
  rendered in real headless Chromium, and Button's colour matrix is gated
  against the WCAG AA 4.5:1 contrast floor in both schemes.

## Installation

`@mattstack/tui-kit` is unpublished; it lives in this monorepo and every
consumer depends on it with `"@mattstack/tui-kit": "workspace:*"`. React 19
is a peer dependency.

## Quickstart

Two calls at your app entry, then use the components anywhere below.

```tsx
import { registerTheme, SoribashiProvider } from "@mattstack/tui-kit/provider";
import { tuiTheme } from "@mattstack/tui-kit/theme";
import "@mattstack/tui-kit/theme.css";
import "@mattstack/tui-kit/canvas.css";   // optional page ground

registerTheme(tuiTheme);                   // module scope, before render

createRoot(document.getElementById("root")!).render(
  <SoribashiProvider theme={tuiTheme}>
    <App />
  </SoribashiProvider>,
);
```

Both halves are required. `registerTheme()` is what the components read to
resolve tokens, vocabulary and intent; `<SoribashiProvider>` is what
`useTheme()` reads inside the tree.

Then render:

```tsx
import { Panel, Button, StatusDot, Chip } from "@mattstack/tui-kit";

function Pipelines() {
  return (
    <Panel title="Pipelines" count={3}>
      <StatusDot intent="ok" tip="build passing" />
      <Chip as="button" intent="cyan" variant="outline">retry</Chip>
      <Button intent="accent" variant="outline">Run</Button>
    </Panel>
  );
}
```

Dark mode is a class on the document element:

```ts
document.documentElement.classList.toggle("dark");
```

TypeScript projects need one more line, an `include` entry for the kit's
ambient CSS-module declaration. See
[docs/consuming.md](docs/consuming.md#the-typescss-modulesdts-include).

## Configuration

- **Theming.** `tuiTheme` is an ordinary soribashi theme. Extend it with
  `createTheme({ extends: tuiTheme, components: [panelTheme.extend({ ... })] })`
  to change defaults or add variants, and pass the result to `registerTheme` and
  `<SoribashiProvider>` in place of `tuiTheme`.
- **Vocabulary.** `size` is `xs` through `xl`; `intent` is `accent`, `ok`,
  `warn`, `bad`, `cyan`, `purple`, `muted`; Button's `variant` is `default`,
  `light`, `outline`, `subtle`.
- **CSS.** The alias custom properties and every component's `data-part` values
  are public API and safe to select on. They are listed in
  [docs/css-contract.md](docs/css-contract.md).
- **Page ground.** `@mattstack/tui-kit/canvas.css` is optional. No component
  requires it; it styles `body` and the column-measure containers for apps that
  want the whole graph-paper page identity.

Full adopter guide, including the export map and the one import rule that
matters: [docs/consuming.md](docs/consuming.md).

## Development

From a clean checkout:

```console
$ git clone https://github.com/m4ttstack/apps.git
$ cd apps
$ bun install                 # workspace install, from the repo root
$ cd packages/tui-kit
$ bun run dev:workshop
```

The workshop is the loop. It renders every component on its own page, in both
colour schemes behind a sidebar Dark toggle, and imports from the package barrel
exactly the way a real consumer would.

The other scripts: `bun run test` (node logic tier plus a real-Chromium browser
tier), `bun run gates` (the mechanical CSS gates plus the codegen drift check),
`bun run typecheck`, `bun run codegen` (regenerates `src/generated/theme.css`
from `src/theme.ts`), `bun run census` (regenerates the token census), and
`bun run build`.

More detail, including the framework dependency and version policy, the test
tiers, and the visual baselines: [docs/development.md](docs/development.md).

## Contributing

Issues and pull requests are welcome.

- Run `bun run test`, `bun run gates` and `bun run typecheck` before opening a
  pull request. `gates` is the one that catches hardcoded values, missing
  tokens, and codegen drift.
- Never hand-write variant colour CSS. Variant colours come from the intent
  resolver via `autoVars`.
- A component change that alters appearance needs its visual baselines updated
  in the same change, and a new component needs its own workshop page.
- The reasoning behind existing choices lives in
  [docs/decisions.md](docs/decisions.md). Read it before changing something that
  looks arbitrary; source files carry only the constraints the code cannot show.

## License

MIT. See [LICENSE](LICENSE).
