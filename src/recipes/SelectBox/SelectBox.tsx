import type { ButtonHTMLAttributes, ComponentProps, MouseEvent, Ref } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./SelectBox.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 1 = pure styled primitive (§ 2.1) — one element, style slots, no lifecycle.
 * `defineComponent`, not `definePolymorphicComponent`: mr-board's SelectBox is
 * always a `<button>` (its own doc comment explains why — a real button so the
 * existing `onRowClick` guard, which ignores clicks on `a, button`, already
 * skips it), so polymorphism is senseless here, the same criterion Icon's own
 * comment cites.
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 1 as const;

/**
 * The recipe's style slots. SelectBox has exactly one addressable element (a
 * bare glyph, not a separate icon element the way CopyButton's Icon child is),
 * so the tuple is `root` alone, the same shape as Icon's own `ICON_SELECTORS`.
 */
const SELECTBOX_SELECTORS = ["root"] as const;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7 — task-8-report.md § 5). Self-identifying per §5's
 * naming rule: a single-slot recipe's own name becomes the root's value,
 * matching Icon's `"icon"` and CopyButton's `"copybutton"` —
 * `.tui-selectbox` becomes `[data-part="selectbox"]`.
 *
 * Module-private (not exported), the same choice Icon and CopyButton made for
 * their own single value.
 *
 * THE SPREAD POSITION IS PART OF THE CONVENTION: stamped in the
 * NON-OVERRIDABLE TAIL, after `{...rest}`, alongside `getStyles` — see
 * Icon.tsx's/Chip.tsx's identical comment for the failure mode this closes.
 */
const SELECTBOX_PART = "selectbox";

/**
 * The recipe's own scalar for its fixed square size — `1.6rem`, which has no
 * theme rung (src/theme.ts's spacing ladder runs …rem150, rem180 with no
 * rem160 between). Routed through a real `vars`-resolver-emitted CSS custom
 * property (Chip's `CHIP_SCALARS` pattern, also used by Segmented's
 * `--sb-segmented-text-size`), retunable via `SelectBox.extend({ vars })`.
 */
const SELECTBOX_SCALARS: Record<string, string> = {
  "--sb-selectbox-size": "1.6rem",
};

/**
 * The recipe's OWN props, byte-identical in shape to mr-board's
 * `src/client/ui/SelectBox.tsx` call signature: `checked`, `onToggle`.
 */
export interface SelectBoxOwnProps {
  checked: boolean;
  onToggle: () => void;
}

/**
 * `TOwnProps` for `defineComponent`, following Icon's/CopyButton's precedent
 * of unioning the target element's native attributes in explicitly. `onClick`
 * is OMITTED for the same reason CopyButton's is: the click handler (toggle +
 * `stopPropagation`) is the recipe's entire behaviour, not a
 * caller-configurable hook, and mr-board's own SelectBox never took one
 * either.
 */
type SelectBoxProps_ = SelectBoxOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref" | "onClick">;

export const SelectBox = defineComponent<
  SelectBoxProps_,
  typeof SELECTBOX_SELECTORS,
  readonly [],
  readonly []
>({
  name: "SelectBox",
  selectors: SELECTBOX_SELECTORS,
  classes,
  vars: () => ({ root: { ...SELECTBOX_SCALARS } }),
  render: ({ props, getStyles, ref }) => {
    // The Styles API's own config keys are consumed internally by useStyles
    // and are not valid DOM attributes, so they are stripped here the same
    // way Icon/Chip/CopyButton strip them. No vocabulary-axis destructure is
    // needed: this recipe opts into no axes.
    const {
      checked,
      onToggle,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    // Verbatim from mr-board's SelectBox: `stopPropagation` so the row's own
    // click guard (which mr-board's own doc comment says already ignores
    // clicks on `a, button`) is belt-and-braces rather than load-bearing.
    const onClick = (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onToggle();
    };

    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        // Band 1, the overridable head: mr-board's own presentation defaults.
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={checked ? "deselect this MR" : "select this MR"}
        // Band 2: everything the consumer passed.
        {...rest}
        // Band 3, the non-overridable tail — nothing below may be replaced
        // from a call site. `onClick` lives here too, not band 1: it is the
        // recipe's entire behaviour, not a presentational default (the same
        // decision CopyButton's `onClick` placement documents).
        {...getStyles("root")}
        data-part={SELECTBOX_PART}
        data-checked={checked || undefined}
        onClick={onClick}
      >
        {checked ? "▣" : "☐"}
      </button>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type SelectBoxProps = ComponentProps<typeof SelectBox>;

/**
 * The recipe's theme-entry convenience export — the no-op `.extend({})` a
 * consumer's `createTheme({ components: [...] })` can start from.
 */
export const selectBoxTheme = SelectBox.extend({});
