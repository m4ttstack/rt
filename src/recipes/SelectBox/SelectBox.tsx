import type { ButtonHTMLAttributes, ComponentProps, MouseEvent, Ref } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./SelectBox.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const SELECTBOX_SELECTORS = ["root"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
const SELECTBOX_PART = "selectbox";

/** Verbatim mr-board value. The spacing ladder runs rem150 -> rem180 with no
    rem160, so this gets a recipe-local property retunable via
    `SelectBox.extend({ vars })`. */
const SELECTBOX_SCALARS: Record<string, string> = {
  "--sb-selectbox-size": "1.6rem",
};

/** SelectBox's own props; `SelectBoxProps` below is the full public surface. */
export interface SelectBoxOwnProps {
  checked: boolean;
  onToggle: () => void;
}

/** `onClick` is omitted: the toggle + stopPropagation IS the recipe's
    behaviour, not a caller-configurable hook. */
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

    // `stopPropagation` so an ancestor row's click guard is belt-and-braces
    // rather than load-bearing.
    const onClick = (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onToggle();
    };

    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={checked ? "deselect this MR" : "select this MR"}
        {...rest}
        // Non-overridable tail. `onClick` belongs here, not among the defaults
        // above: it is the recipe's whole behaviour.
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

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const selectBoxTheme = SelectBox.extend({});
