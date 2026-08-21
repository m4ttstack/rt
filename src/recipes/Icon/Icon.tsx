import type { ComponentProps, ReactNode, SVGProps } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Icon.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const ICON_SELECTORS = ["root"] as const;

/**
 * Stable selector surface for app-side CSS, since CSS-module class names are
 * hashed. Stamped in the non-overridable tail (after `{...rest}`) so an
 * `<Icon data-part="…" />` cannot sever an app's `[data-part="icon"]` rules.
 *
 * The kit-wide value rule: root slot -> the lowercased recipe name; every other
 * slot -> `<recipe>-<slot key>`. Self-identifying, so a value never needs an
 * ancestor to disambiguate which recipe it reaches into.
 */
const ICON_PART = "icon";

/** Icon's own props; `IconProps` below is the full public surface. */
export interface IconOwnProps {
  /** The SVG path data for the glyph. */
  d: string;
  /** Draws a centred circle behind the path (mr-board's `light`/`settings`). */
  circle?: boolean;
}

/**
 * Geometry below is mr-board's `src/client/ui/Icon.tsx`, unchanged. These stay
 * SVG presentation attributes rather than tokens because that is what they are
 * in the source — defeated by any CSS a consumer applies.
 *
 * The kit-wide spread order, which every recipe follows: (1) the recipe's own
 * presentation defaults, replaceable by a consumer; (2) `{...rest}`; (3) the
 * non-overridable tail — `getStyles` then `data-part`.
 */
export const Icon = defineComponent<
  IconOwnProps & Omit<SVGProps<SVGSVGElement>, "ref">,
  typeof ICON_SELECTORS,
  readonly [],
  readonly [],
  SVGSVGElement
>({
  name: "Icon",
  selectors: ICON_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    // classNames/styles/vars/attributes/unstyled are the Styles API's own
    // config keys, consumed by useStyles and not valid DOM attributes.
    const {
      d,
      circle,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <svg
        ref={ref}
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...(rest as SVGProps<SVGSVGElement>)}
        {...getStyles("root")}
        data-part={ICON_PART}
      >
        {circle && <circle cx="12" cy="12" r="4" />}
        <path d={d} />
      </svg>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type IconProps = ComponentProps<typeof Icon>;

/** mr-board's glyph dictionary, verbatim — same keys, path data, and order.
    Pre-rendered elements, because that is the shape call sites consume. */
export const ICONS: Record<string, ReactNode> = {
  rows: <Icon d="M3 6h18M3 12h18M3 18h18" />,
  grid: <Icon d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  light: (
    <Icon
      circle
      d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
    />
  ),
  dark: <Icon d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  system: <Icon d="M2 4h20v12H2zM8 20h8m-4-4v4" />,
  menu: <Icon d="M3 6h18M3 12h18M3 18h18" />,
  close: <Icon d="M6 6l12 12M18 6L6 18" />,
  refresh: (
    <Icon d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  ),
  people: (
    <Icon d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  ),
  settings: (
    <Icon
      circle
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
    />
  ),
  // Below: deck's glyph set, lucide 1.27.0 path data. circle/rect elements
  // flattened into `d` (Icon has no fill-shape slot), same arc math for every
  // conversion: M(cx-r) cy a r r 0 1 0 (2r) 0 a r r 0 1 0 (-2r) 0.
  plus: <Icon d="M5 12h14M12 5v14" />,
  "external-link": (
    <Icon d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  ),
  "triangle-alert": (
    <Icon d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01" />
  ),
  // Subpath joins below stay explicit ("M…l…" not "m…"): a bare `m` here would
  // inherit the arc's endpoint as its origin instead of the standalone
  // coordinate lucide's own separate <path> intended.
  "circle-check": <Icon d="M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M9 12l2 2 4-4" />,
  "file-warning": (
    <Icon d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM12 9v4M12 17h.01" />
  ),
  "refresh-cw": (
    <Icon d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />
  ),
  pencil: (
    <Icon d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4" />
  ),
  "trash-2": (
    <Icon d="M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  ),
  "lock-keyhole": (
    <Icon d="M11 16a1 1 0 1 0 2 0a1 1 0 1 0-2 0M5 10L19 10A2 2 0 0 1 21 12L21 20A2 2 0 0 1 19 22L5 22A2 2 0 0 1 3 20L3 12A2 2 0 0 1 5 10ZM7 10V7a5 5 0 0 1 10 0v3" />
  ),
  "user-round-check": (
    <Icon d="M2 21a8 8 0 0 1 13.292-6M5 8a5 5 0 1 0 10 0a5 5 0 1 0-10 0M16 19l2 2 4-4" />
  ),
  "rotate-ccw": <Icon d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />,
};

/** Outside ICONS because CopyButton toggles between them by path, not by name. */
export const COPY_ICON = "M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1";
export const CHECK_ICON = "M20 6 9 17l-5-5";

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const iconTheme = Icon.extend({});
