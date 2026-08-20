import type { ButtonHTMLAttributes, ComponentProps, MouseEvent, Ref } from "react";
import { useState } from "react";
import { defineComponent } from "../../builders.ts";
import { CHECK_ICON, COPY_ICON, Icon } from "../Icon/Icon.tsx";
import classes from "./CopyButton.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 1 = pure styled primitive (§ 2.1) — one element, style slots, no lifecycle
 * a consumer observes (the copied flash is internal, timer-driven state, not
 * an external open/close a caller controls). `defineComponent`, not
 * `definePolymorphicComponent`: mr-board's CopyButton is always a `<button>`
 * (it writes to the clipboard on click — there is no other element this would
 * ever render as), so polymorphism is senseless here, the same criterion
 * Icon's own comment cites.
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 1 as const;

/**
 * The recipe's style slots. CopyButton has exactly one addressable element
 * (the icon comes from the Icon recipe, which stamps its own `data-part`; the
 * optional label is a bare `<span>` with no styling of its own to key on), so
 * the tuple is `root` alone, the same shape as Icon's own `ICON_SELECTORS`.
 */
const COPYBUTTON_SELECTORS = ["root"] as const;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7 — task-8-report.md § 5). Self-identifying per §5's
 * naming rule: CopyButton has a single slot, so its OWN NAME becomes the
 * root's value, matching Icon's `"icon"` and Segmented's `"segmented"` —
 * `.tui-copy` becomes `[data-part="copybutton"]`.
 *
 * Module-private (not exported), the same choice Icon made for its own single
 * value: nothing outside this file needs to reference the string, since the
 * recipe has only one slot and the adoption pass can hardcode
 * `[data-part="copybutton"]` directly.
 *
 * THE SPREAD POSITION IS PART OF THE CONVENTION: stamped in the
 * NON-OVERRIDABLE TAIL, after `{...rest}`, alongside `getStyles` — see
 * Icon.tsx's/Chip.tsx's identical comment for the failure mode this closes.
 */
const COPYBUTTON_PART = "copybutton";

/**
 * The recipe's OWN props, byte-identical in shape to mr-board's
 * `src/client/ui/CopyButton.tsx` call signature: `text`, `title`, `label?`.
 * `className` is DELIBERATELY NOT redeclared (the board original required
 * it): the builder's own `{...rest}`/universal-style-props surface already
 * accepts one, the same "own props hold only what the recipe itself defines"
 * split Chip/Icon use — which is exactly why the brief's own interface
 * listing marks it `className?` rather than the board's required form.
 */
export interface CopyButtonOwnProps {
  /** The text written to the clipboard on click. */
  text: string;
  /** The accessible name, and the button's `title` outside the copied flash. */
  title: string;
  /** Optional text rendered beside the icon (mr-board's drawer action form). */
  label?: string;
}

/**
 * `TOwnProps` for `defineComponent`, following Icon's precedent of unioning
 * the target element's native attributes in explicitly (the builder does not
 * compose these automatically the way `definePolymorphicComponent`'s `as`
 * machinery does). `onClick` is OMITTED: the click handler is the recipe's
 * entire behaviour (the clipboard write + flash), not a caller-configurable
 * hook — mr-board's own CopyButton never took one either, and admitting one
 * here would let a call site silently replace the copy behaviour via
 * `{...rest}`. `ref` is omitted the same way Icon omits it, since the
 * builder supplies its own.
 */
type CopyButtonProps_ = CopyButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref" | "onClick">;

export const CopyButton = defineComponent<
  CopyButtonProps_,
  typeof COPYBUTTON_SELECTORS,
  readonly [],
  readonly []
>({
  name: "CopyButton",
  selectors: COPYBUTTON_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    // The Styles API's own config keys are consumed internally by useStyles
    // and are not valid DOM attributes, so they are stripped here the same
    // way Icon/Chip strip them. No vocabulary-axis destructure is needed:
    // this recipe opts into no axes.
    const {
      text,
      title,
      label,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    // useState/useEffect-free local state: `render` runs inside the
    // builder's own forwardRef function-component body on every render (see
    // define-component.tsx), unconditionally, so a hook called here obeys
    // the rules of hooks exactly as if it were written directly in a
    // function component.
    const [copied, setCopied] = useState(false);

    // Verbatim from mr-board's CopyButton: `stopPropagation` so a copy click
    // inside a clickable row/card never also fires the row's own click, and
    // the SAME optional-chaining shape — `navigator.clipboard?.writeText(...)
    // .then(...)` short-circuits the ENTIRE chain (including `.then`) when
    // `clipboard` is nullish, so this does not need a defensive `?.then`.
    const onClick = (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(text).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        },
        () => {},
      );
    };

    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        // Band 1, the overridable head: mr-board's own presentation defaults.
        type="button"
        aria-label={title}
        title={copied ? "copied" : title}
        // Band 2: everything the consumer passed.
        {...rest}
        // Band 3, the non-overridable tail — nothing below may be replaced
        // from a call site. `onClick` lives here too, not band 1: it is the
        // recipe's entire behaviour, not a presentational default a call
        // site should be able to shadow (the type already omits `onClick`
        // from the public surface; this is the runtime half of that same
        // decision).
        {...getStyles("root")}
        data-part={COPYBUTTON_PART}
        data-copied={copied || undefined}
        onClick={onClick}
      >
        <Icon d={copied ? CHECK_ICON : COPY_ICON} />
        {label && <span>{copied ? "copied" : label}</span>}
      </button>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type CopyButtonProps = ComponentProps<typeof CopyButton>;

/**
 * The recipe's theme-entry convenience export — the no-op `.extend({})` a
 * consumer's `createTheme({ components: [...] })` can start from.
 */
export const copyButtonTheme = CopyButton.extend({});
