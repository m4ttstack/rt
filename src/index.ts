/**
 * The kit's public barrel — `@mattstack/tui-kit`.
 *
 * FINALIZED (controller ruling R9, task 15): every recipe, the hooks family,
 * and `tuiTheme` are all re-exported from here. The barrel stays-narrow
 * INTERIM period (tasks 9-14, recipes only) is over — this is the kit's
 * settled public surface.
 *
 * The subpath exports (`/hooks`, `/theme`, `/theme.css`, `/canvas.css`) are
 * UNCHANGED and keep working exactly as before: this barrel ADDS a
 * convenience surface, it does not replace them. A consumer who wants to
 * import only the hooks, or only the theme (e.g. to pass to a `create-theme`
 * call without pulling in every recipe's module graph at the type level),
 * still reaches for the subpath directly.
 *
 * WHY IT WAS SAFE TO WIDEN (the check R9 asked Task 15 to perform, now
 * performed): the interim comment worried that re-exporting `tuiTheme`'s
 * VALUE from here would put its value graph in front of a consumer who only
 * wants `<Icon />`, the same edge `src/builders.ts` avoids by importing the
 * theme TYPE-only (to stay acyclic against a future per-component
 * `.extend()` entry the theme might grow). That worry does not apply to this
 * file: `src/index.ts` imports every recipe's `.tsx` directly already (each
 * of which imports `../../builders.ts`, which type-only-imports the theme),
 * so `src/index.ts` was ALREADY downstream of `builders.ts` before this
 * export existed. Re-exporting `tuiTheme`'s value here from `./theme.ts`
 * adds no new cycle — `theme.ts` itself imports nothing from `index.ts` or
 * `builders.ts` — it only makes explicit a value a consumer previously had to
 * reach via the `/theme` subpath. Confirmed empirically too:
 * `bun run typecheck` stays clean with this export in place.
 *
 * One block per recipe, alphabetical by recipe name. Each block exports, in
 * this order:
 *   1. the component,
 *   2. its `<name>Theme = Recipe.extend({})` convenience entry,
 *   3. any constants the recipe owns (glyph dictionaries, path data, …),
 *   4. its two props types — `<Name>OwnProps` (what the recipe itself defines)
 *      and `<Name>Props` (everything a call site may pass, the builder's free
 *      style/Styles-API surface included).
 *
 * `recipeCategory` is deliberately never re-exported: it is a per-module
 * authoring record that scripts/derive.ts reads off the recipe module directly,
 * and every recipe exporting a symbol of that name would collide here.
 *
 * The hooks family and `tuiTheme` are re-exported as their own block, after
 * every recipe block, mirroring `src/hooks/index.ts`'s own export list and
 * `src/theme.ts`'s own `tuiTheme` name exactly — no renaming.
 */

export { Chip, CHIP_PARTS, chipTheme } from "./recipes/Chip/Chip.tsx";
export type { ChipOwnProps, ChipProps } from "./recipes/Chip/Chip.tsx";

export {
  CONTEXTMENU_PARTS,
  ContextMenu,
  contextMenuTheme,
} from "./recipes/ContextMenu/ContextMenu.tsx";
export type {
  ContextMenuItemOwnProps,
  ContextMenuItemProps,
  ContextMenuLabelOwnProps,
  ContextMenuLabelProps,
  ContextMenuOwnProps,
  ContextMenuProps,
  ContextMenuSeparatorOwnProps,
  ContextMenuSeparatorProps,
} from "./recipes/ContextMenu/ContextMenu.tsx";

export { CopyButton, copyButtonTheme } from "./recipes/CopyButton/CopyButton.tsx";
export type { CopyButtonOwnProps, CopyButtonProps } from "./recipes/CopyButton/CopyButton.tsx";

export { CHECK_ICON, COPY_ICON, Icon, ICONS, iconTheme } from "./recipes/Icon/Icon.tsx";
export type { IconOwnProps, IconProps } from "./recipes/Icon/Icon.tsx";

export { Markdown, markdownTheme } from "./recipes/Markdown/Markdown.tsx";
export type { MarkdownOwnProps, MarkdownProps } from "./recipes/Markdown/Markdown.tsx";

export { MODAL_PARTS, Modal, modalTheme } from "./recipes/Modal/Modal.tsx";
export type { ModalOwnProps, ModalProps } from "./recipes/Modal/Modal.tsx";

export { Panel, PANEL_PARTS, panelTheme } from "./recipes/Panel/Panel.tsx";
export type { PanelOwnProps, PanelProps } from "./recipes/Panel/Panel.tsx";

export {
  LabeledSeg,
  labeledSegTheme,
  SEGMENTED_PARTS,
  Segmented,
  segmentedTheme,
} from "./recipes/Segmented/Segmented.tsx";
export type {
  LabeledSegOwnProps,
  LabeledSegProps,
  SegmentedOwnProps,
  SegmentedProps,
} from "./recipes/Segmented/Segmented.tsx";

export { SelectBox, selectBoxTheme } from "./recipes/SelectBox/SelectBox.tsx";
export type { SelectBoxOwnProps, SelectBoxProps } from "./recipes/SelectBox/SelectBox.tsx";

export { SIDEDRAWER_PARTS, SideDrawer, sideDrawerTheme } from "./recipes/SideDrawer/SideDrawer.tsx";
export type {
  SideDrawerOwnProps,
  SideDrawerProps,
  SideDrawerSide,
} from "./recipes/SideDrawer/SideDrawer.tsx";

export { STATUSDOT_PARTS, StatusDot, statusDotTheme } from "./recipes/StatusDot/StatusDot.tsx";
export type { StatusDotOwnProps, StatusDotProps } from "./recipes/StatusDot/StatusDot.tsx";

export { TOASTHOST_PARTS, ToastHost, toastHostTheme } from "./recipes/ToastHost/ToastHost.tsx";
export type { ToastHostOwnProps, ToastHostProps } from "./recipes/ToastHost/ToastHost.tsx";

// The hooks family — same export list as `./hooks/index.ts` (the `/hooks`
// subpath), re-exported here as a convenience. No renaming.
export {
  acquireScrollLock,
  handleEscape,
  pushLayer,
  releaseScrollLock,
  useAutoGrowTextarea,
  useBodyScrollLock,
  useEscapeClose,
  useRevealOnChange,
  useToasts,
} from "./hooks/index.ts";
export type { OverflowTarget, Toast } from "./hooks/index.ts";

// The theme — same export as `./theme.ts` (the `/theme` subpath), re-exported
// here as a value (see this file's header comment for why that is safe: this
// barrel is already downstream of `builders.ts`, which is already downstream
// of the theme, via every recipe import above).
export { tuiTheme } from "./theme.ts";

// The app-entry wiring — same two exports as `./provider.ts` (the `/provider`
// subpath). `tuiTheme`'s companions: `registerTheme(tuiTheme)` at module
// scope, `<SoribashiProvider theme={tuiTheme}>` around the tree.
//
// They MUST be reachable from this package rather than imported by an adopter
// from `@soribashi/core` directly: bundlers key module identity by resolved
// path, and an adopter's own `@soribashi/core` resolves down a different path
// than the one this kit's own files resolve down — yielding two
// `SoribashiContext` objects and a silent fallback to the DEFAULT theme.
// `src/provider.ts` carries the full mechanism and the measurement.
//
// Costs this barrel nothing: every recipe above already pulls
// `@soribashi/factory` in through `builders.ts`, so the module graph is
// unchanged by adding these two names.
export { registerTheme, SoribashiProvider } from "./provider.ts";
