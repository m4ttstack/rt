import type { ComponentProps, ReactNode, Ref, SVGProps } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Icon.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 1 = pure styled primitive (§ 2.1) — one element, style slots, no lifecycle.
 * `defineComponent` rather than `definePolymorphicComponent`: there is no other
 * element an inline-SVG glyph would ever render as, so polymorphism is
 * senseless here (SKILL.md § 2's own criterion for the choice).
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 1 as const;

/**
 * The recipe's style slots. Icon has exactly one addressable element, so the
 * tuple is `root` alone; the const assertion is what keeps `getStyles`'s slot
 * argument and `RecipeMeta.slots` from drifting apart.
 */
const ICON_SELECTORS = ["root"] as const;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1). NOT
 * soribashi's: soribashi's builders stamp only the vocabulary-axis attributes
 * (`data-variant` / `data-intent` / `data-size`) and a recipe must never
 * hand-emit those. `data-part` is this kit's own addition, and it is
 * hand-stamped precisely because nothing in the framework knows about it.
 *
 * Why it exists: CSS-module class names are hashed, so mr-board's residual
 * `style.css` cannot select into a recipe's internals the way it does today
 * (`.tui-review svg { … }`, `.tui-drawer-controls .tui-seg button { … }`).
 * A stable data attribute is the replacement selector surface.
 *
 * The value rule, which every later recipe follows:
 *   - root slot        -> the lowercased recipe name  (`icon`, `segmented`)
 *   - every other slot -> `<lowercased recipe name>-<slot key>` (`segmented-item`)
 * So a value is globally unambiguous on its own — an app-side override never
 * needs a second attribute or an ancestor to disambiguate which recipe it is
 * reaching into — and the root's value is the drop-in replacement for the
 * board class the recipe absorbed.
 */
const ICON_PART = "icon";

/**
 * The recipe's OWN props — the part of the surface Icon itself defines.
 *
 * The full public surface is `IconProps` below: this, plus every SVG attribute,
 * plus the Styles API (`classNames`/`styles`/`vars`/…) and the universal style
 * props the builder adds for free. Two exported types rather than one because
 * they answer different questions ("what does this recipe add?" vs "what may I
 * pass?"), and every later recipe exports the same pair.
 */
export interface IconOwnProps {
  /** The SVG path data for the glyph. */
  d: string;
  /** Draws a centred circle behind the path (mr-board's `light`/`settings`). */
  circle?: boolean;
}

/**
 * Every geometry attribute below is mr-board's `src/client/ui/Icon.tsx`,
 * unchanged: 24x24 viewBox, a 14px painted box, unfilled, 2-wide round-capped
 * `currentColor` strokes. They stay SVG ATTRIBUTES rather than becoming theme
 * tokens because that is what they are in the source — presentation attributes
 * on the element, defeated by any CSS the consumer applies — and because a
 * `size` axis would be an API promotion this straight port does not make.
 *
 * `...rest` is spread AFTER them, so a consumer can override any one of them
 * (including `aria-hidden`, to promote a decorative glyph into a labelled
 * `role="img"`), and BEFORE `getStyles('root')`, so the recipe's own class and
 * vars always win over a raw `className`/`style` — the same ordering
 * soribashi's Button uses.
 */
export const Icon = defineComponent<
  IconOwnProps & Omit<SVGProps<SVGSVGElement>, "ref">,
  typeof ICON_SELECTORS,
  readonly [],
  readonly []
>({
  name: "Icon",
  selectors: ICON_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    // The Styles API's own config keys (classNames/styles/vars/attributes/
    // unstyled) are consumed internally by useStyles and are not valid DOM
    // attributes, so they are stripped here the same way Button strips them.
    // No vocabulary-axis destructure is needed: Icon opts into no axes, so
    // `size`/`intent`/`variant` are not part of its prop surface at all.
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
        // KNOWN SORIBASHI LIMITATION, not a silenced bug: every builder
        // hardcodes `HTMLElement` as the ref element type — `Ref<HTMLElement>`
        // on the render ctx (define-component.tsx) and `RefAttributes<
        // HTMLElement>` on the produced component type. An SVG root is outside
        // that type in both directions, so this cast is required here, and a
        // CONSUMER holding a `useRef<SVGSVGElement>(null)` cannot pass it to
        // `<Icon ref={…} />` without a cast of their own (verified: TS2322,
        // "SVGSVGElement is missing … accessKey, autocapitalize, and 26 more").
        // The ref lands on a real SVGSVGElement at runtime regardless. Filed as
        // a friction; nothing in the kit takes an Icon ref today.
        ref={ref as Ref<SVGSVGElement>}
        data-part={ICON_PART}
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
      >
        {circle && <circle cx="12" cy="12" r="4" />}
        <path d={d} />
      </svg>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type IconProps = ComponentProps<typeof Icon>;

/**
 * mr-board's glyph dictionary, moved verbatim (same keys, same path data, same
 * `circle` flags, same source order). Pre-rendered elements rather than a
 * `Record<string, string>` of path data because that is the shape mr-board's
 * call sites consume (`{ICONS[name]}`), and changing it would be an API
 * promotion this straight port does not make.
 */
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
};

/**
 * Two glyphs mr-board keeps outside ICONS because CopyButton toggles between
 * them by path rather than by name. Moved verbatim; they become CopyButton's
 * inputs when that recipe lands.
 */
export const COPY_ICON = "M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1";
export const CHECK_ICON = "M20 6 9 17l-5-5";

/**
 * The recipe's theme-entry convenience export. Every recipe ships one: it is
 * the no-op `.extend({})` a consumer's `createTheme({ components: [...] })`
 * can start from, and having it named means invariant 1's public surface is
 * exercised from the barrel rather than only from tests.
 */
export const iconTheme = Icon.extend({});
