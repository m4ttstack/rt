import type { ComponentProps, HTMLAttributes, Ref } from "react";
import { defineComponent } from "../../builders.ts";
import type { Toast } from "../../hooks/index.ts";
import classes from "./ToastHost.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 1 = pure styled primitive (§ 2.1) — two style slots (host + entry), no
 * lifecycle a consumer observes (the queue itself lives in Task 7's
 * `useToasts` hook, not here). `defineComponent`, not
 * `definePolymorphicComponent`: a toast stack never renders as anything other
 * than the fixed-position host + its entries, the same criterion Icon's own
 * comment cites for its svg root.
 *
 * PAIRS WITH `useToasts` (src/hooks/index.ts, Task 7). This recipe takes the
 * hook's `toasts` array straight through — its own `Toast` type is imported
 * from there rather than redeclared, so the two stay one type by
 * construction rather than by convention.
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 1 as const;

/**
 * The recipe's style slots. `root` is `.tui-toasts` (the fixed-position
 * stack); `toast` is `.tui-toast` (one entry).
 */
const TOASTHOST_SELECTORS = ["root", "toast"] as const;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7 — task-8-report.md § 5, which SUPERSEDES this task's
 * own brief). Self-identifying, so a value works standing alone from
 * mr-board's residual `style.css` without needing an ancestor to disambiguate
 * which recipe it is:
 *
 *   root slot  -> "toasthost"       (the drop-in replacement for `.tui-toasts`)
 *   toast slot -> "toasthost-toast" (the drop-in replacement for `.tui-toast`)
 *
 * Exported (not module-private, unlike Icon's single value) because the
 * adoption pass rewrites mr-board's `.tui-toasts`/`.tui-toast` call sites onto
 * these two values and a typo in either is silent on both sides of the
 * boundary.
 *
 * THE SPREAD POSITION IS PART OF THE CONVENTION: `data-part` is stamped in
 * the NON-OVERRIDABLE TAIL, after `{...rest}`, alongside `getStyles` — see
 * Icon.tsx's/Chip.tsx's/StatusDot.tsx's identical comment for the failure
 * mode this closes. Pinned by ToastHost.test.tsx's "a consumer-supplied
 * data-part does not win".
 */
export const TOASTHOST_PARTS = { root: "toasthost", toast: "toasthost-toast" } as const;

/**
 * The recipe's own scalar for the host's fixed offset from the viewport edge
 * — the `16px` ToastHost.module.css's block comment explains has no theme
 * rung (it is a position offset, not a padding/margin/gap literal, and no
 * other ladder happens to carry the same value either). Unconditional (not
 * keyed by props), the same shape Chip's `CHIP_SCALARS` / StatusDot's
 * `STATUSDOT_SCALARS` use.
 */
const TOASTHOST_SCALARS: Record<string, string> = {
  "--sb-toasthost-offset": "16px",
};

/**
 * The recipe's OWN props. The full public surface is `ToastHostProps` below:
 * this, plus every div attribute, plus the Styles API and the universal style
 * props the builder adds for free.
 */
export interface ToastHostOwnProps {
  /** The live queue, straight from Task 7's `useToasts()`. */
  toasts: Toast[];
}

type ToastHostProps_ = ToastHostOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "ref">;

export const ToastHost = defineComponent<
  ToastHostProps_,
  typeof TOASTHOST_SELECTORS,
  readonly [],
  readonly []
>({
  name: "ToastHost",
  selectors: TOASTHOST_SELECTORS,
  classes,
  // StatusDot's shape: a recipe-supplied `vars` resolver REPLACES the
  // builder's automatic `autoVars` call (skill § 4 + § 10), and there is
  // nothing to merge in because ToastHost declares no `variants` either
  // (task-8-report.md § 4's second corollary).
  vars: (_theme, _props) => ({ root: { ...TOASTHOST_SCALARS } }),
  render: ({ props, getStyles, ref }) => {
    // The Styles API's own config keys are consumed internally by useStyles
    // and are not valid DOM attributes, so they are stripped here the same
    // way Icon/Chip/CopyButton/StatusDot strip them. No vocabulary-axis
    // destructure is needed: ToastHost opts into no axes.
    const {
      toasts,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    // Verbatim from mr-board's own ToastHost: an empty queue renders NOTHING
    // AT ALL, not a hidden or empty fixed-position box sitting over the page.
    // Safe to early-return here (unlike a hook call, `render` is a plain
    // function invoked by the builder's own always-run component body — see
    // define-component.tsx — so there is no rules-of-hooks concern).
    if (toasts.length === 0) return null;

    return (
      <div
        // KNOWN SORIBASHI LIMITATION (SORI-14, filed against Icon's svg
        // root): every builder's render ctx types `ref` as `Ref<HTMLElement>`
        // rather than the element this recipe actually renders, so a cast is
        // required even though `<div>` IS an HTMLElement — CopyButton/
        // Segmented/StatusDot cast the same way for the same reason.
        ref={ref as Ref<HTMLDivElement>}
        // Band 1, the overridable head: mr-board's own presentation
        // defaults. A consumer may replace either, which is how
        // ToastHost.test.tsx's "a consumer can override the default role"
        // case works.
        role="status"
        aria-live="polite"
        // Band 2: everything the consumer passed.
        {...rest}
        // Band 3, the non-overridable tail — nothing below may be replaced
        // from a call site.
        {...getStyles("root")}
        data-part={TOASTHOST_PARTS.root}
      >
        {toasts.map((t) => (
          <div key={t.id} {...getStyles("toast")} data-part={TOASTHOST_PARTS.toast}>
            {t.text}
          </div>
        ))}
      </div>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type ToastHostProps = ComponentProps<typeof ToastHost>;

/**
 * The recipe's theme-entry convenience export — the no-op `.extend({})` a
 * consumer's `createTheme({ components: [...] })` can start from.
 */
export const toastHostTheme = ToastHost.extend({});
