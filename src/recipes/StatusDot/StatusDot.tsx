import type { ComponentProps, HTMLAttributes, Ref } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./StatusDot.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 1 = pure styled primitive (§ 2.1) — two style slots, no lifecycle.
 * `defineComponent`, not `definePolymorphicComponent`: a status dot never
 * renders as anything other than the wrap+glyph pair, the same criterion
 * Icon's own comment cites for its svg root.
 *
 * THE GENERIC PROMOTION (per this task's brief). mr-board's own StatusDot
 * takes an `mr: BoardMR` and derives the ok/warn/bad classification itself
 * (`!mr.blockers?.any ? "ok" : ... ? "bad" : "warn"`, plus a
 * `statusReasons(mr)` tooltip string) — see mr-board's
 * `src/client/board/StatusDot.tsx`. That derivation is board domain logic,
 * not a kit concern (invariant 2: the kit owns presentation, not app data
 * shapes), so it stays board-side. This recipe is the GENERIC promotion: it
 * takes the ALREADY-DERIVED `intent`/`tip` pair, the same split Chip made for
 * its own `intent` prop.
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 1 as const;

/**
 * The recipe's style slots. `root` is `.tui-dot-wrap` (the tooltip anchor);
 * `dot` is `.tui-dot` (the coloured glyph).
 */
const STATUSDOT_SELECTORS = ["root", "dot"] as const;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7 — task-8-report.md § 5, which SUPERSEDES this task's
 * own brief: the brief's `root`/`dot` values are the LOSING convention).
 * Self-identifying, so a value works standing alone from mr-board's residual
 * `style.css` without needing an ancestor to disambiguate which recipe it is:
 *
 *   root slot -> "statusdot"      (the drop-in replacement for `.tui-dot-wrap`)
 *   dot slot  -> "statusdot-dot"  (the drop-in replacement for `.tui-dot`)
 *
 * Exported (not module-private, unlike Icon's single value) because the
 * adoption pass rewrites mr-board's `.tui-dot`/`.tui-dot-wrap`/`.tui-dot.ok`
 * etc. call sites onto these two values and a typo in either is silent on
 * both sides of the boundary.
 *
 * THE SPREAD POSITION IS PART OF THE CONVENTION: `data-part` is stamped in
 * the NON-OVERRIDABLE TAIL, after `{...rest}`, alongside `getStyles` — see
 * Icon.tsx's/Chip.tsx's identical comment for the failure mode this closes.
 * Pinned by StatusDot.test.tsx's "a consumer-supplied data-part does not
 * win".
 */
export const STATUSDOT_PARTS = { root: "statusdot", dot: "statusdot-dot" } as const;

/**
 * StatusDot's colour table: `intent` maps DIRECTLY to the dot tokens
 * (`--dot-ok`/`--dot-warn`/`--dot-bad`), NOT through `autoVars`/the theme's
 * intent resolver (src/intent-resolver.ts's `tuiIntentResolver`).
 *
 * Contrast what the resolver WOULD do: `FAMILY.ok -> "green"`, so an
 * `autoVars`-derived `ok` would land on `--color-green-500` — mr-board's
 * ORDINARY text green, the same hue every other `intent="ok"` control in the
 * kit uses (Chip's outline, a future Button's border, ...). The dot family is
 * deliberately a SEPARATE, more saturated palette (`colors.dot.{ok,warn,bad}`
 * in src/theme.ts, emitted as the `--dot-*` aliases) — a status dot has to
 * read at a glance across a wall of rows, so it gets its own visibility
 * budget rather than borrowing the shade every other "ok" thing uses.
 * Routing it through the resolver would silently collapse that distinction.
 *
 * This is the § 6 dimension-record pattern, keyed by CONCERN (Chip's
 * `CHIP_SCALARS` precedent) rather than by the theme's `size` vocabulary,
 * because `intent` here is StatusDot's own three-value scalar, not the
 * theme's seven-value `intent` axis — which is also why `vocabularyAxes` is
 * deliberately NOT declared on the builder config below: opting `intent` in
 * would validate call sites against the theme's full seven-value vocabulary
 * (`accent`/`ok`/`warn`/`bad`/`cyan`/`purple`/`muted`) and route colour
 * through `autoVars`, exactly the two things this recipe must not do.
 */
const STATUSDOT_TONES: Record<StatusDotOwnProps["intent"], string> = {
  ok: "var(--dot-ok)",
  warn: "var(--dot-warn)",
  bad: "var(--dot-bad)",
};

/**
 * The recipe's own scalar for the tooltip's vertical offset — the `1.5em`
 * StatusDot.module.css's block comment explains has no theme rung by design.
 * Unconditional (not keyed by props), so it is always present the same way
 * Chip's `CHIP_SCALARS` are.
 */
const STATUSDOT_SCALARS: Record<string, string> = {
  "--sd-tooltip-offset": "1.5em",
};

/**
 * The recipe's OWN props. The full public surface is `StatusDotProps` below:
 * this, plus every span attribute, plus the Styles API and the universal
 * style props the builder adds for free.
 */
export interface StatusDotOwnProps {
  /**
   * Which of the three dot tokens colours the glyph. A three-value RECIPE
   * scalar, not the theme's `intent` vocabulary axis — see `STATUSDOT_TONES`
   * above for why the two must not be conflated.
   */
  intent: "ok" | "warn" | "bad";
  /**
   * The tooltip text. Rendered via mr-board's own mechanism verbatim:
   * `data-tip` stamped on the root, read by `.root::after`'s CSS
   * `content: attr(data-tip)`. Straight port, so it carries the same
   * accessibility ceiling mr-board's version has — the tooltip is CSS-only
   * and exposes nothing to assistive tech; a consumer who needs the status
   * announced adds `role`/`aria-label` themselves (see
   * StatusDot.test.tsx's "a consumer can promote the dot to an announced
   * status").
   */
  tip?: string;
}

type StatusDotProps_ = StatusDotOwnProps & Omit<HTMLAttributes<HTMLSpanElement>, "ref">;

export const StatusDot = defineComponent<
  StatusDotProps_,
  typeof STATUSDOT_SELECTORS,
  readonly [],
  readonly []
>({
  name: "StatusDot",
  selectors: STATUSDOT_SELECTORS,
  classes,
  // A RECIPE-SUPPLIED `vars` RESOLVER REPLACES THE BUILDER'S AUTOMATIC
  // autoVars CALL (skill § 4 + § 10) — but StatusDot declares no `variants`,
  // so there is no auto-derived output to preserve/merge here (task-8-report
  // .md § 4's second corollary): this `vars` key is the recipe's ENTIRE
  // colour + scalar story, nothing to merge in.
  vars: (_theme, props) => ({
    root: { ...STATUSDOT_SCALARS },
    dot: { "--sd-color": STATUSDOT_TONES[(props as StatusDotOwnProps).intent] },
  }),
  render: ({ props, getStyles, ref }) => {
    // The Styles API's own config keys are consumed internally by useStyles
    // and are not valid DOM attributes, so they are stripped here the same
    // way Icon/Chip/CopyButton strip them. No vocabulary-axis destructure is
    // needed: StatusDot opts into no axes. `intent` IS destructured out even
    // though it is not a Styles API key, because it is consumed by the
    // `vars` resolver above (from the raw props, before `render` runs), not
    // by `render` itself — left in `rest` it would leak onto the DOM as a
    // raw `intent="ok"` attribute, exactly the leak § 7 warns about for
    // axis props, even though this one is recipe-local rather than the
    // builder's own axis.
    const {
      intent: _intent,
      tip,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <span
        // KNOWN SORIBASHI LIMITATION (SORI-14, filed against Icon's svg
        // root): every builder's render ctx types `ref` as `Ref<HTMLElement>`
        // rather than the element this recipe actually renders, so a cast is
        // required at the use site even though `<span>` IS an HTMLElement —
        // `Ref<HTMLElement>` is not assignable to `Ref<HTMLSpanElement>`
        // (RefObject.current is invariant). CopyButton/Segmented cast the
        // same way for the same reason.
        ref={ref as Ref<HTMLSpanElement>}
        // Band 2: everything the consumer passed. No band-1 presentation
        // defaults: unlike Icon's svg attributes or CopyButton's `type`/
        // `title`, the wrap has nothing that reads as a courtesy default —
        // its whole presentation is the stylesheet plus the two data
        // attributes below.
        {...rest}
        // Band 3, the non-overridable tail — nothing below may be replaced
        // from a call site. `data-tip` lives here (not band 1) because it is
        // DERIVED from the `tip` prop, not a raw pass-through value a
        // consumer would ever set directly.
        {...getStyles("root")}
        data-part={STATUSDOT_PARTS.root}
        data-tip={tip}
      >
        <span {...getStyles("dot")} data-part={STATUSDOT_PARTS.dot}>
          ●
        </span>
      </span>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type StatusDotProps = ComponentProps<typeof StatusDot>;

/**
 * The recipe's theme-entry convenience export — the no-op `.extend({})` a
 * consumer's `createTheme({ components: [...] })` can start from.
 */
export const statusDotTheme = StatusDot.extend({});
