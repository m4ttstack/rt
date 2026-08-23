export * from '@mantine/core';

// `RangePicker` (batch C) is built on `@mantine/dates`' `DatePickerInput`,
// so its own types/components are re-exported here too, same as
// `@mantine/core` above. Checked for collisions against `@mantine/core`'s
// star export by compiling `export * from '@mantine/core'; export * from
// '@mantine/dates';` in isolation (`tsc` would raise TS2308 "has already
// exported a member named ..." for any ambiguous name) -- zero collisions
// found, so no explicit named re-exports are needed to disambiguate.
export * from '@mantine/dates';

// Shadows (Table, TextInput, CopyButton -- see the eslint wall in
// src/ui/**). Named exports placed AFTER the `export *` above, so they win
// over the star-exported Mantine originals (proven by the
// reference-inequality tests in src/ui/forms/forms.test.tsx for each
// shadow).
export { MantineTable, Table } from './table/Table';
export type { TableProps } from './table/Table';
export { TextInput } from './text-input/TextInput';
export type { TextInputProps } from './text-input/TextInput';

// Batch A: feedback + utility components. Mostly plain named exports, with
// one deliberate collision: the kit now intentionally SHADOWS Mantine's
// headless render-prop `CopyButton` with its own labeled,
// batteries-included copy button (named export after the star, exactly the
// Table/TextInput convention above). `CopyActionIcon` remains the icon-only
// sibling under its own collision-free name.
export { CopyActionIcon, CopyButton } from './copy-button/CopyButton';
export type {
  CopyActionIconProps,
  CopyButtonProps,
} from './copy-button/CopyButton';
export { IconTooltip } from './icon-tooltip/IconTooltip';
export type { IconTooltipProps } from './icon-tooltip/IconTooltip';
export {
  HoverBox,
  HoverGroup,
  HoverStack,
} from './hover-wrappers/HoverWrappers';
export type {
  HoverBoxProps,
  HoverGroupProps,
  HoverStackProps,
} from './hover-wrappers/HoverWrappers';
export { CollapsibleAlertCard } from './collapsible-alert-card/CollapsibleAlertCard';
export type { CollapsibleAlertCardProps } from './collapsible-alert-card/CollapsibleAlertCard';
export { GenericError } from './generic-error/GenericError';
export type { GenericErrorProps } from './generic-error/GenericError';
export { LazyLoader } from './lazy-loader/LazyLoader';
export type { LazyLoaderProps } from './lazy-loader/LazyLoader';

// Batch B: layout primitives. No naming collisions with `@mantine/core`
// (Mantine has no `PageShell`/`ContentContainer`/`SlideInSidebar`/`Notch`/
// `GradientBorder`/`AnimatedBorderBox` exports -- verified against the
// installed package).
export { PageShell } from './page-shell/PageShell';
export type { PageShellProps } from './page-shell/PageShell';
// PageShell's sub-components ride on the static attachments
// (PageShell.Sidebar and friends), so only the context hook and the
// sub-components' props types cross the barrel for consumers composing
// their own shell pieces (or typing wrappers around the statics).
export { usePageShellContext } from './page-shell/hooks';
export type { PageShellContentProps } from './page-shell/components/Content';
export type { PageShellHeaderProps } from './page-shell/components/Header';
export type { PageShellSidebarProps } from './page-shell/components/Sidebar';
// The tab bar itself is rendered by the PageShell root (its `tabs` prop),
// so only the tab shape and the height constant cross the barrel.
// Collision-checked like the names above: neither exists in
// `@mantine/core`/`@mantine/dates`.
export { PAGE_SHELL_TAB_BAR_HEIGHT } from './page-shell/components/TabBar';
export type { PageShellTab } from './page-shell/components/TabBar';
// `SiteShell` collision-checked the same way as the names above: neither
// `@mantine/core` nor `@mantine/dates` exports a `SiteShell` (Mantine's own
// shell is `AppShell`), so this is a plain named export, not a shadow.
export { SiteShell } from './site-shell/SiteShell';
export type { SiteShellProps } from './site-shell/SiteShell';
export { ContentContainer } from './content-container/ContentContainer';
export type { ContentContainerProps } from './content-container/ContentContainer';
// `MAX_CONTENT_WIDTH` collision-checked like the component names above:
// neither `@mantine/core` nor `@mantine/dates` exports it, so this is a
// plain named export, not a shadow.
export { MAX_CONTENT_WIDTH } from './content-container/ContentContainer';
export { SlideInSidebar } from './slide-in-sidebar/SlideInSidebar';
export type { SlideInSidebarProps } from './slide-in-sidebar/SlideInSidebar';
export { Notch } from './notch/Notch';
export type { NotchProps } from './notch/Notch';
export { GradientBorder } from './gradient-border/GradientBorder';
export type { GradientBorderProps } from './gradient-border/GradientBorder';
export { AnimatedBorderBox } from './animated-border-box/AnimatedBorderBox';
export type { AnimatedBorderBoxProps } from './animated-border-box/AnimatedBorderBox';

// Batch C: lists, menus, virtualization, and a date-range picker. No naming
// collisions with `@mantine/core`/`@mantine/dates` (verified the same way
// as the `export *` above -- none of these names exist in either package).
export { SelectableList } from './selectable-list/SelectableList';
export type {
  SelectableListItemProps,
  SelectableListProps,
} from './selectable-list/SelectableList';
export {
  AcceptableList,
  AcceptableListItem,
} from './acceptable-list/AcceptableList';
export type {
  AcceptableListItemProps,
  AcceptableListProps,
} from './acceptable-list/AcceptableList';
export { SearchableMenu } from './searchable-menu/SearchableMenu';
export type { SearchableMenuProps } from './searchable-menu/SearchableMenu';
export { HybridMenu } from './hybrid-menu/HybridMenu';
export type {
  HybridMenuAction,
  HybridMenuOption,
  HybridMenuProps,
} from './hybrid-menu/HybridMenu';
export { VirtualList } from './virtual-list/VirtualList';
export type { VirtualListProps } from './virtual-list/VirtualList';
export {
  VirtualTable,
  VirtualTableHeader,
  VirtualTableShell,
} from './virtual-table/VirtualTable';
export type {
  VirtualTableColumn,
  VirtualTableHeaderProps,
  VirtualTableProps,
  VirtualTableShellProps,
} from './virtual-table/VirtualTable';
export { RangePicker } from './range-picker/RangePicker';
export type {
  RangePickerPreset,
  RangePickerProps,
  RangePickerValue,
} from './range-picker/RangePicker';

// App chrome rail (a mini icon rail): RailShell hosts a
// Rail of RailEntrys, wired by useRailState. No naming collisions with
// `@mantine/core`/`@mantine/dates` (verified by grepping both installed
// packages' index.d.ts for `Rail` -- zero hits in either), so these are
// plain named exports, not shadows.
export {
  RAIL_WIDTH,
  RAIL_WIDTH_EXPANDED,
  RailShell,
} from './rail-shell/RailShell';
export type { RailShellProps } from './rail-shell/RailShell';
export { Rail } from './rail-shell/Rail';
export type { RailProps } from './rail-shell/Rail';
export { RailEntry } from './rail-shell/RailEntry';
export type { RailEntryProps } from './rail-shell/RailEntry';
export { useRailState } from './rail-shell/useRailState';
export type { RailState, UseRailStateOptions } from './rail-shell/useRailState';
