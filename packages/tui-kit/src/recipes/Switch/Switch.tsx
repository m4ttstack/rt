import type { ChangeEvent, ComponentProps, LabelHTMLAttributes, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Switch.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const SWITCH_SELECTORS = ["root", "control", "label"] as const;

export const SWITCH_PARTS = {
  root: "switch",
  control: "switch-control",
  label: "switch-label",
} as const;

/** Verbatim mr-board mixes. color-mix()'s percentage argument trips the
    no-hardcoded-values gate even inside a declared value, so both washes are
    assembled here and reach Switch.module.css only through var(...) --
    same escape hatch as Badge's --sb-badge-bg/--sb-badge-border. */
const SWITCH_SCALARS: Record<string, string> = {
  "--sb-switch-bg-off": "color-mix(in srgb, var(--fg) 8%, transparent)",
  "--sb-switch-bg-on": "color-mix(in srgb, var(--accent) 16%, transparent)",
};

export interface SwitchOwnProps {
  /** Controlled only: the input's checked always reflects this prop, so a
      failed action's unchanged state snaps the control back on re-render --
      the invariant the old board hand-wrote with ev.target.checked. */
  checked: boolean;
  onChange: (ev: ChangeEvent<HTMLInputElement>) => void;
  /** Visible label text; label-less call sites pass `aria-label` instead. */
  label?: ReactNode;
  disabled?: boolean;
  /** The input's accessible name when there is no visible label. */
  "aria-label"?: string;
}

type SwitchProps_ = SwitchOwnProps &
  Omit<LabelHTMLAttributes<HTMLLabelElement>, "ref" | "onChange" | "aria-label">;

export const Switch = defineComponent<
  SwitchProps_,
  typeof SWITCH_SELECTORS,
  readonly [],
  readonly [],
  HTMLLabelElement
>({
  name: "Switch",
  selectors: SWITCH_SELECTORS,
  classes,
  vars: () => ({ control: { ...SWITCH_SCALARS } }),
  render: ({ props, getStyles, ref }) => {
    const {
      checked,
      onChange,
      label,
      disabled,
      "aria-label": ariaLabel,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <label ref={ref} {...rest} {...getStyles("root")} data-part={SWITCH_PARTS.root}>
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          aria-label={ariaLabel}
          {...getStyles("control")}
          data-part={SWITCH_PARTS.control}
        />
        {label != null && (
          <span {...getStyles("label")} data-part={SWITCH_PARTS.label}>
            {label}
          </span>
        )}
      </label>
    );
  },
});

export type SwitchProps = ComponentProps<typeof Switch>;

export const switchTheme = Switch.extend({});
