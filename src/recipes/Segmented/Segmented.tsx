import type { StylesApiProps, UniversalStyleProps } from "@soribashi/core";
import type { ReactElement, Ref } from "react";
import { defineGenericComponent } from "../../builders.ts";
import { ICONS } from "../Icon/Icon.tsx";
import classes from "./Segmented.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 4 = generic/form control (§ 2.5). `defineGenericComponent`, not
 * `defineComponent`: both `Segmented<T>` and `LabeledSeg<T>` need REAL GENERIC
 * TYPE INFERENCE over the caller's own option type — `<Segmented options={
 * ["rows","grid"] as const} value={v} onChange={(v) => ...}>` must type
 * `onChange`'s parameter as the caller's own union, not `string`. That is
 * exactly the skill's own criterion for this builder (task-8-report.md § 3,
 * quoting it: "options: T[], value: T, onChange: (value: T) => void inferring
 * T at the call site").
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS. One recipe DIRECTORY, two exported recipes, per this
 * task's own brief ("Segmented (+LabeledSeg)") — RESOLVED as controller
 * ruling R11 (task 15): `scripts/derive.ts`'s `buildManifestEntriesForDir`
 * collects EVERY RecipeMeta-carrying export in a directory's module, not only
 * the one matching the directory name, so `LabeledSeg` below (its own
 * RecipeMeta, name "LabeledSeg") gets its own manifest entry alongside
 * `Segmented`'s — both sharing this directory's files/category/token
 * dependencies, since those are properties of the FILES, not of either
 * recipe individually. (`Recipe.extend({})` results — `segmentedTheme`,
 * `labeledSegTheme` — still carry no RecipeMeta and are still skipped, the
 * same way Icon.tsx's `ICONS`/`COPY_ICON`/`CHECK_ICON` constants are.) See
 * scripts/derive.ts's header comment (point 4) for the full rationale and why
 * a same-directory split (giving LabeledSeg its own four files) was rejected
 * as the larger change.
 */
export const recipeCategory = 4 as const;

/**
 * The recipe's style slots, shared by both `Segmented` and `LabeledSeg` (one
 * CSS shape, `.tui-seg` / `.tui-seg-text`, two call sites onto it).
 */
const SEGMENTED_SELECTORS = ["root", "option"] as const;
type SegmentedSelectorName = (typeof SEGMENTED_SELECTORS)[number];

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7 — see task-8-report.md § 5, which supersedes this
 * task's own brief: the brief's `root`/`option` values are the LOSING
 * convention). Both slots render REAL DOM in this recipe (the outer
 * `role="group"` span for `root`, each `<button>` for `option`), so neither
 * hits `defineGenericComponent`'s no-DOM-root limitation (task-8-report.md
 * § 3): `getStyles('root')` is called on an actual host element, and its
 * axis-attribute / style-prop machinery lands there normally. That limitation
 * only bites a generic recipe whose `root` is a context provider with no DOM
 * of its own (Base UI's `Select.Root`, which this kit does not use at all).
 *
 *   root slot   -> "segmented"          (the drop-in replacement for `.tui-seg`)
 *   option slot -> "segmented-option"
 *
 * Exported (not module-private, unlike Icon's single value) because Task 20's
 * adoption pass rewrites ~10 board selectors (`.tui-seg`, `.tui-seg button`,
 * `.tui-seg-text button`, the ancestor-scoped height/flex rules) onto these
 * two values and a typo in either is silent on both sides.
 */
export const SEGMENTED_PARTS = { root: "segmented", option: "segmented-option" } as const;

/**
 * The `FactoryPayload` shape `StylesApiProps` needs to type `classNames`/
 * `styles`/`vars`/`attributes` against this recipe's own selector union —
 * `defineGenericComponent` composes NONE of this automatically (unlike
 * `defineComponent`/`definePolymorphicComponent`'s render-ctx machinery); a
 * category-4 recipe spells it out itself, following soribashi's Select.
 */
interface SegmentedPayload {
  props: Record<string, unknown>;
  stylesNames: SegmentedSelectorName;
}

/**
 * `Segmented`'s own props, byte-identical in shape to mr-board's
 * `src/client/ui/Segmented.tsx` call signature: `options`, `value`, `onChange`,
 * `label`. `className` is NOT redeclared here (unlike the board original,
 * which never took one) because the builder's own `{...rest}`/universal-style-
 * props surface already accepts it — the same "own props hold only what the
 * recipe itself defines" split Chip/Icon use.
 */
export interface SegmentedOwnProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}

/** Everything a call site may pass: own props, the Styles API, and the
 * universal style props the builder still extracts for every generic
 * component (`useStyleProps` runs for all four builders alike, skill § 5). */
export interface SegmentedProps<T extends string>
  extends SegmentedOwnProps<T>,
    StylesApiProps<SegmentedPayload>,
    UniversalStyleProps {}

/**
 * The author-supplied generic call signature `defineGenericComponent`'s
 * `TSignature` type parameter preserves through the returned component (see
 * define-generic-component.tsx's doc comment and Select.tsx's own
 * `SelectSignature`, the pattern this mirrors): `<Segmented<Tab> ...>` types
 * `onChange`'s parameter as `Tab`, not `string`. This is the ENTIRE public
 * type of `Segmented` — forgetting to pass it explicitly (leaving
 * `defineGenericComponent`'s first type argument to default to
 * `GenericComponentFn`) would silently drop every prop's typing to `any`.
 */
export type SegmentedSignature = <T extends string>(
  props: SegmentedProps<T> & { ref?: Ref<HTMLSpanElement> },
) => ReactElement | null;

/**
 * `defineGenericComponent`'s four type parameters
 * (`TSignature, TSelectors, TVariants, TVocabAxes`, read off
 * define-generic-component.tsx's source) are spelled out explicitly, the way
 * Select does, rather than left to inference.
 *
 * NO VOCABULARY AXES, NO VARIANTS. mr-board's Segmented carries no
 * intent/variant/size prop at all — it is one fixed neutral shape with an
 * accent-filled active state, not a colour-bearing family the way Chip is.
 * Opting into an axis here would be an API promotion this straight port does
 * not make (Icon's § 3/§ 15 precedent: a recipe with zero axes omits
 * `vocabularyAxes` and `variants` entirely, and the automatic `autoVars`
 * fallback is then a harmless no-op).
 */
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
    // The Styles API's own config keys are consumed internally by useStyles
    // and are not valid DOM attributes, so they are stripped here the same
    // way Icon/Chip strip them. No vocabulary-axis destructure is needed:
    // this recipe opts into no axes, so size/intent/variant are not part of
    // its prop surface at all.
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
        // KNOWN SORIBASHI LIMITATION (SORI-14, filed against Icon's svg root):
        // every builder's render ctx types `ref` as `Ref<unknown>` here
        // (define-generic-component.tsx), not narrowed to the element this
        // recipe actually renders, so a cast is required at the use site.
        // Unlike Icon's svg case this one is at least assignable in both
        // directions once cast (a `<span>` IS an HTMLElement), so only the
        // recipe-side cast is needed; a consumer's `useRef<HTMLSpanElement>`
        // still cannot be passed to `<Segmented ref={...} />` without one of
        // their own, for the same reason SORI-14 documents.
        ref={ref as Ref<HTMLSpanElement>}
        // Band 1, the overridable head: mr-board's own presentation attributes.
        role="group"
        aria-label={label}
        // Band 2: everything the consumer passed.
        {...rest}
        // Band 3, the non-overridable tail — nothing below may be replaced
        // from a call site. THE SPREAD POSITION IS PART OF THE CONVENTION;
        // see SEGMENTED_PARTS's comment and Icon.tsx's/Chip.tsx's identical
        // three-band ordering.
        {...getStyles("root")}
        data-part={SEGMENTED_PARTS.root}
      >
        {options.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              // A DELIBERATE ADDITION, not a lift: mr-board's `.tui-seg`
              // buttons never set `type` explicitly (so default to
              // "submit"). Explicit `type="button"` is the same class of
              // "never submit a surrounding form" safety Chip's `as="button"`
              // form adds.
              type="button"
              title={o}
              aria-label={o}
              onClick={() => onChange(o)}
              {...getStyles("option")}
              data-part={SEGMENTED_PARTS.option}
              // Hand-stamped boolean modifier (Chip's `data-pulse`/
              // `-dimmed`/`-uppercase` precedent), `|| undefined` so the
              // attribute is ABSENT rather than `="false"` — which is what
              // makes the bare `[data-active]` selector in the stylesheet
              // mean what it reads as. Replaces the board's `className={o
              // === value ? "active" : ""}`.
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

/**
 * `LabeledSeg`'s own props, byte-identical in shape to mr-board's
 * `src/client/ui/Segmented.tsx` `LabeledSeg` call signature: `legend`,
 * `options`, `labels`, `value`, `onChange`.
 */
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

/**
 * The recipe's own scalar for the text-mode option font size — the "0.8em" the
 * dimension-record pattern's rationale (task-8-report.md § 4) covers even
 * though this is a single unkeyed value, not a size-keyed record: `em` has no
 * theme rung by design (src/theme.ts), and Chip's `CHIP_SCALARS` is the
 * precedent for routing a rung-less recipe value through a REAL `vars`-
 * resolver-emitted CSS custom property (retunable via
 * `LabeledSeg.extend({ vars })`) rather than a decorative `var(--x, <fallback>)`
 * that nothing ever actually sets.
 */
const SEGMENTED_TEXT_SCALARS: Record<string, string> = {
  "--sb-segmented-text-size": "0.8em",
};

/**
 * `LabeledSeg` shares `Segmented`'s selectors, classes, and `SEGMENTED_PARTS`
 * (one CSS shape, two call sites) but is its OWN `defineGenericComponent`
 * call: the two components' prop shapes differ too much (`label` vs.
 * `legend`+`labels`, icon glyphs vs. text) to share one generic signature.
 */
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
        // `.tui-seg-text`, the board's second class on this same span
        // (`<span className="tui-seg tui-seg-text">`). A hand-stamped
        // boolean modifier, not a vocabulary axis — see SEGMENTED_PARTS's
        // comment and Segmented.module.css's `.root[data-text]` rule.
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

/**
 * The recipe's theme-entry convenience exports. One per component (`Segmented`
 * and `LabeledSeg` are independently themeable, per their independent
 * `defineGenericComponent` calls above).
 */
export const segmentedTheme = Segmented.extend({});
export const labeledSegTheme = LabeledSeg.extend({});
