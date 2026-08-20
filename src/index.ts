/**
 * The kit's public barrel — `@mattstack/tui-kit`.
 *
 * The subpath exports (`/hooks`, `/theme`, `/provider`, `/theme.css`,
 * `/canvas.css`) keep working unchanged: this barrel adds a convenience
 * surface, it does not replace them. A consumer who wants only the hooks or
 * only the theme still reaches for the subpath, which avoids pulling in every
 * recipe's module graph.
 *
 * One block per recipe, alphabetical, each exporting the component, its
 * `<name>Theme` entry, any constants it owns, and its two props types.
 *
 * `recipeCategory` is deliberately never re-exported: scripts/derive.ts reads
 * it off each recipe module directly, and every recipe exporting a symbol of
 * that name would collide here.
 */

export { Badge, BADGE_PARTS, badgeTheme } from "./recipes/Badge/Badge.tsx";
export type { BadgeOwnProps, BadgeProps } from "./recipes/Badge/Badge.tsx";

export { Button, BUTTON_PARTS, buttonTheme } from "./recipes/Button/Button.tsx";
export type { ButtonOwnProps, ButtonProps } from "./recipes/Button/Button.tsx";

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
  /** @deprecated see the type's own JSDoc in ContextMenu.tsx. */
  ContextMenuSeparatorOwnProps,
  ContextMenuSeparatorProps,
} from "./recipes/ContextMenu/ContextMenu.tsx";

export { CopyButton, copyButtonTheme } from "./recipes/CopyButton/CopyButton.tsx";
export type { CopyButtonOwnProps, CopyButtonProps } from "./recipes/CopyButton/CopyButton.tsx";

export {
  FIELD_PARTS,
  RadioGroup,
  radioGroupTheme,
  TextArea,
  textAreaTheme,
  TextField,
  textFieldTheme,
} from "./recipes/Field/Field.tsx";
export type {
  RadioGroupOwnProps,
  RadioGroupProps,
  TextAreaOwnProps,
  TextAreaProps,
  TextFieldOwnProps,
  TextFieldProps,
} from "./recipes/Field/Field.tsx";

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

export { Spinner, SPINNER_PARTS, spinnerTheme } from "./recipes/Spinner/Spinner.tsx";
export type { SpinnerOwnProps, SpinnerProps } from "./recipes/Spinner/Spinner.tsx";

export { STATUSDOT_PARTS, StatusDot, statusDotTheme } from "./recipes/StatusDot/StatusDot.tsx";
export type { StatusDotOwnProps, StatusDotProps } from "./recipes/StatusDot/StatusDot.tsx";

export { SWITCH_PARTS, Switch, switchTheme } from "./recipes/Switch/Switch.tsx";
export type { SwitchOwnProps, SwitchProps } from "./recipes/Switch/Switch.tsx";

export { TOASTHOST_PARTS, ToastHost, toastHostTheme } from "./recipes/ToastHost/ToastHost.tsx";
export type { ToastHostOwnProps, ToastHostProps } from "./recipes/ToastHost/ToastHost.tsx";

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

export { tuiTheme } from "./theme.ts";

// `tuiTheme`'s companions: `registerTheme(tuiTheme)` at module scope,
// `<SoribashiProvider theme={tuiTheme}>` around the tree. Reached through
// `./provider.ts` rather than `@soribashi/core` for the module-identity reason
// that file records.
export { registerTheme, SoribashiProvider } from "./provider.ts";
