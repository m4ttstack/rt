/**
 * The kit's public barrel — `@mattstack/tui-kit`.
 *
 * RECIPES ONLY — FOR NOW. The theme, the hooks family, and the two stylesheets
 * each have their own package.json export subpath (`/theme`, `/hooks`,
 * `/theme.css`, `/canvas.css`), so nothing is unreachable while this barrel
 * stays narrow.
 *
 * This is an INTERIM shape, not a settled one (controller ruling R9): the
 * barrel stays recipes-only through Task 14, and TASK 15 FINALIZES IT per its
 * own brief (recipes + hooks + tuiTheme). Do not widen it before then.
 *
 * The reason to keep it narrow meanwhile, for whoever does widen it: a consumer
 * that wants only `<Icon />` should not pull the theme's value graph in with it,
 * and `src/builders.ts` imports the theme TYPE only precisely to keep that graph
 * acyclic (see its own comment). Re-exporting `tuiTheme` from HERE is not the
 * same edge as `builders.ts` importing it, so widening is a check to perform,
 * not a rule to break.
 *
 * One block per recipe, alphabetical by recipe name; tasks 9-15 each append
 * theirs. Each block exports, in this order:
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
 */

export { Chip, CHIP_PARTS, chipTheme } from "./recipes/Chip/Chip.tsx";
export type { ChipOwnProps, ChipProps } from "./recipes/Chip/Chip.tsx";

export { CopyButton, copyButtonTheme } from "./recipes/CopyButton/CopyButton.tsx";
export type { CopyButtonOwnProps, CopyButtonProps } from "./recipes/CopyButton/CopyButton.tsx";

export { CHECK_ICON, COPY_ICON, Icon, ICONS, iconTheme } from "./recipes/Icon/Icon.tsx";
export type { IconOwnProps, IconProps } from "./recipes/Icon/Icon.tsx";

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

export { STATUSDOT_PARTS, StatusDot, statusDotTheme } from "./recipes/StatusDot/StatusDot.tsx";
export type { StatusDotOwnProps, StatusDotProps } from "./recipes/StatusDot/StatusDot.tsx";

export { TOASTHOST_PARTS, ToastHost, toastHostTheme } from "./recipes/ToastHost/ToastHost.tsx";
export type { ToastHostOwnProps, ToastHostProps } from "./recipes/ToastHost/ToastHost.tsx";
