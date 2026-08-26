---
name: building-with-mantine-kit
description: Use when writing, reviewing, or debugging UI in an app that already uses mantine-kit, including picking components, theming, colors, icons, forms, layout, and router links.
---

# Building with mantine-kit

The kit already owns colors, layout frames, form plumbing, and user feedback.
Building correctly means reaching for the affordance that owns each job rather
than rebuilding it locally. Every rule below is that one idea.

Recipes live in `AGENTS.md` §5 (facades) and §6 (storage/color-scheme hooks).
To install the kit or sync it forward, use `adopting-mantine-kit`.

## The rules

1. **Import from `@ui/*`.** Never `@mantine/*` or `lucide-react` in app code.
   ESLint enforces this and names the fix, so spend no thought on it.

2. **Look for the kit component before writing one.** The table below is the
   common set; the full surface is `bun run dev` then `/docs` (a page per
   component and hook), plus `bun run storybook`.

3. **Never write a color literal.** Surfaces take `bg="bg-level-2"` on any
   color prop, scheme-aware with no light/dark conditional. Everything else
   comes from `useSchemeColors()`: `bg.level1..4` / `bg.color(c)` /
   `bg.lightened(c)`, `text.muted` / `text.dimmed` / `text.highContrast(c)`,
   `border.default` / `border.style(c)`.

4. **Take icons from the registry.** `Icons.<name>` or `<Icon name="..." />`.
   A new icon is a `lucideWrapperFn` entry in `src/ui/icons/Icons.ts`;
   `IconName` derives from the registry, so there is no second list to update.

5. **Let the theme carry defaults.** Already set app-wide: tooltips and menus
   pop down (`pop-top-left`, position `bottom`, 400ms), dropdowns carry
   `shadow="md"`, `Group` is `nowrap`/`gap="xs"`, `Card` and `Paper` are flat,
   `Badge` is `light` and not uppercased, `Select` has `allowDeselect={false}`,
   radius is `md`. Re-passing these per-usage is noise that drifts.

6. **Let the shells carry layout.** `PageShell.Content` is already the page's
   scroll frame _and_ its capped, centered content column;
   `PageShell.Sidebar` already scrolls its own children. Tune them via
   `scrollAreaProps` / `contentContainerProps`; your own nested `ScrollArea`
   or `Container` gives you two scrollbars or two columns. Full-bleed content
   opts out with `contentContainer={false}`; under `scrollClamp` the column is
   already off, since that mode hands the frame to you.

7. **One `PageShell` per page, one `RailShell` per app.** They compose and
   wire themselves: host the `PageShell` in `RailShell`'s children and pass
   nothing. The rail publishes its `headerHeight` and the page defaults its
   `topOffset` to it. An explicit `topOffset` is for chrome the kit did not
   render.

8. **Build forms from `@ui/forms`.** `useForm` + `zodResolver(schema)` inside
   `FormContainer`, or `useModalForm` when the form lives in a modal (it owns
   the modal, loading state, and success notification, and parses values
   through zod before your `onSubmit` sees them). `FormContainer`'s escape
   hatches are independent: `plain` drops the `Paper` when something else owns
   the surface, `hideChrome` drops the error `Alert` and submit row when you
   need your own. With `hideChrome` you own error display, so route failures
   somewhere visible such as `notifications.error`.

9. **Talk to the user through the facades.** `notifications.success` /
   `.error` / `.warning` / `.info` to tell, `modals.confirm` (with
   `destructive: true` where it fits) and `modals.prompt` to ask.

10. **Take storage and color-scheme hooks from `@ui/hooks`.** The kit's
    `useLocalStorage` / `useSessionStorage` read synchronously on first
    render; Mantine's own default reads in an effect and flashes the default.

11. **Route typed-router links through `createLink()`.** A bare
    `component={Link}` compiles but silently widens a typed `to` prop to
    `string`, so route typos stop being caught. `RailEntry` is most exposed.

12. **To ADD a treatment to a subtree wrap it in `ThemeOverrideWrapper`; to
    SUBTRACT one give it a baseline with `ThemeIsland`.** The wrapper merges
    onto the parent theme, so it can add but never remove. Rendering a dev
    route, embedded view, or print layout in the kit's own look is
    `<ThemeIsland theme={baseTheme} baseSurfaces>`. Never nest a bare
    `MantineProvider`: its variables land on `:root` and its color-scheme
    manager writes to the document root. Preset a call site with `.withProps`
    or a small wrapper component.

13. **Brand the app in `app-theme.ts`, never in `base-theme.ts` or
    `theme.ts`.** Those two are kit-owned and replaced wholesale on every
    sync; `app-theme.ts` merges on top and is never touched. Brand color
    _names_ also go in `app-colors.ts`.

## Which affordance for which job

| Need                          | Use                                                                            | Not                             |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| Page with sidebar/header/tabs | `PageShell` compound (`Sidebar`/`Header`/`Main`/`Content`, `topNotch`, `tabs`) | a hand-rolled layout            |
| App-level mini icon rail      | `RailShell` + `Rail` + `RailEntry` + `useRailState`                            | a second `PageShell`            |
| Capped, centered page column  | `PageShell.Content` (on by default), or `ContentContainer` standalone          | your own `Container`            |
| The kit's look inside a brand | `ThemeIsland theme={baseTheme} baseSurfaces`                                   | a hand-written "plain" override |
| Inline collapsing side panel  | `SlideInSidebar`                                                               | a `Drawer`                      |
| Overlay panel over content    | `Drawer`                                                                       | `SlideInSidebar`                |
| Long list or table (1000s)    | `VirtualList` / `VirtualTable`                                                 | mapping the whole array         |
| Hover hint on an icon         | `IconTooltip`                                                                  | `Tooltip` wrapping `ActionIcon` |
| Copy affordance               | `CopyButton` (labelled) or `CopyActionIcon` (icon-only)                        | a hand-rolled clipboard button  |
| Validated form                | `useForm` + `FormContainer`                                                    | raw `useState` fields           |
| Form inside a modal           | `useModalForm`                                                                 | `FormContainer` plus your modal |

## Adding to the kit

`AGENTS.md` §2 has the placement rule: generic goes in `src/ui/core/<name>/`,
product-specific stays in the app. Anything landing in the kit ships stories,
tests, and a docs page in the same change, and must stay tree-shakeable (no
top-level mutations, `/* @__PURE__ */` on top-level factory calls). `bun run
treeshake` is the gate.
