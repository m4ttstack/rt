import type { StylesApiProps, UniversalStyleProps } from "@soribashi/core";
import type { ReactElement, Ref } from "react";
import { defineGenericComponent } from "../../builders.ts";
import { ICONS } from "../Icon/Icon.tsx";
import classes from "./Segmented.module.css";

/**
 * Authoring category (4 = generic/form control). Read off this module by
 * scripts/derive.ts to build the kit's manifest; not dead code.
 *
 * `defineGenericComponent` because both components need real generic inference
 * over the caller's option type: `onChange`'s parameter must be the caller's
 * own union, not `string`.
 *
 * ONE DIRECTORY, TWO RECIPES. derive.ts collects every RecipeMeta-carrying
 * export in a directory's module, so `LabeledSeg` gets its own manifest entry
 * alongside `Segmented`, both sharing this directory's files and category.
 */
export const recipeCategory = 4 as const;

/** Shared by both components: one CSS shape, two call sites onto it. */
const SEGMENTED_SELECTORS = ["root", "option"] as const;
type SegmentedSelectorName = (typeof SEGMENTED_SELECTORS)[number];

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
export const SEGMENTED_PARTS = { root: "segmented", option: "segmented-option" } as const;

/** The `FactoryPayload` shape `StylesApiProps` needs to type the Styles API
    against this recipe's selectors — `defineGenericComponent` composes none of
    this automatically, unlike the other builders. */
interface SegmentedPayload {
  props: Record<string, unknown>;
  stylesNames: SegmentedSelectorName;
}

/** Segmented's own props; `SegmentedProps` below is the full public surface. */
export interface SegmentedOwnProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}

export interface SegmentedProps<T extends string>
  extends SegmentedOwnProps<T>,
    StylesApiProps<SegmentedPayload>,
    UniversalStyleProps {}

/**
 * The generic call signature `defineGenericComponent` preserves through the
 * returned component. This IS the entire public type of `Segmented`: leaving
 * the builder's first type argument to its default would silently drop every
 * prop's typing to `any`.
 */
export type SegmentedSignature = <T extends string>(
  props: SegmentedProps<T> & { ref?: Ref<HTMLSpanElement> },
) => ReactElement | null;

/** No vocabulary axes and no variants: mr-board's Segmented is one fixed
    neutral shape with an accent-filled active state, not a colour-bearing
    family, so opting into an axis would be an API promotion. */
export const Segmented = defineGenericComponent<
  SegmentedSignature,
  typeof SEGMENTED_SELECTORS,
  readonly [],
  readonly []
>({
  name: "Segmented",
  selectors: SEGMENTED_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    const {
      options,
      value,
      onChange,
      label,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props as SegmentedOwnProps<string> & Record<string, unknown>;

    return (
      <span
        // `defineGenericComponent` types the render ctx's ref as `Ref<unknown>`,
        // so a cast is required at the use site.
        ref={ref as Ref<HTMLSpanElement>}
        role="group"
        aria-label={label}
        {...rest}
        {...getStyles("root")}
        data-part={SEGMENTED_PARTS.root}
      >
        {options.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              type="button"
              title={o}
              aria-label={o}
              onClick={() => onChange(o)}
              {...getStyles("option")}
              data-part={SEGMENTED_PARTS.option}
              // `|| undefined` keeps the attribute ABSENT rather than
              // `="false"`, which is what makes the bare `[data-active]`
              // selector in the stylesheet work.
              data-active={active || undefined}
            >
              {ICONS[o] ?? o}
            </button>
          );
        })}
      </span>
    );
  },
});

/** LabeledSeg's own props; `LabeledSegProps` below is the full public surface. */
export interface LabeledSegOwnProps<T extends string> {
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
}

export interface LabeledSegProps<T extends string>
  extends LabeledSegOwnProps<T>,
    StylesApiProps<SegmentedPayload>,
    UniversalStyleProps {}

export type LabeledSegSignature = <T extends string>(
  props: LabeledSegProps<T> & { ref?: Ref<HTMLSpanElement> },
) => ReactElement | null;

/** Verbatim mr-board value. An em has no theme rung by design, but still needs
    a `var()` outlet to pass the CSS gate. */
const SEGMENTED_TEXT_SCALARS: Record<string, string> = {
  "--sb-segmented-text-size": "0.8em",
};

/** Shares Segmented's selectors, classes and parts (one CSS shape) but is its
    own builder call: the two prop shapes differ too much for one signature. */
export const LabeledSeg = defineGenericComponent<
  LabeledSegSignature,
  typeof SEGMENTED_SELECTORS,
  readonly [],
  readonly []
>({
  name: "LabeledSeg",
  selectors: SEGMENTED_SELECTORS,
  classes,
  vars: (_theme, _props) => ({ root: { ...SEGMENTED_TEXT_SCALARS } }),
  render: ({ props, getStyles, ref }) => {
    const {
      legend,
      options,
      labels,
      value,
      onChange,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props as LabeledSegOwnProps<string> & Record<string, unknown>;

    return (
      <span
        ref={ref as Ref<HTMLSpanElement>}
        role="group"
        aria-label={legend}
        {...rest}
        {...getStyles("root")}
        data-part={SEGMENTED_PARTS.root}
        // `.tui-seg-text`, the board's second class on this same span.
        data-text
      >
        {options.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              {...getStyles("option")}
              data-part={SEGMENTED_PARTS.option}
              data-active={active || undefined}
            >
              {labels[o]}
            </button>
          );
        })}
      </span>
    );
  },
});

/** No-op `.extend({})` entries; the two are independently themeable. */
export const segmentedTheme = Segmented.extend({});
export const labeledSegTheme = LabeledSeg.extend({});
