import type { ButtonHTMLAttributes, ComponentProps, MouseEvent } from "react";
import { useState } from "react";
import { defineComponent } from "../../builders.ts";
import { CHECK_ICON, COPY_ICON, Icon } from "../Icon/Icon.tsx";
import classes from "./CopyButton.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const COPYBUTTON_SELECTORS = ["root"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
const COPYBUTTON_PART = "copybutton";

/** CopyButton's own props; `CopyButtonProps` below is the full public surface. */
export interface CopyButtonOwnProps {
  /** The text written to the clipboard on click. */
  text: string;
  /** The accessible name, and the button's `title` outside the copied flash. */
  title: string;
  /** Optional text rendered beside the icon. */
  label?: string;
}

/** `onClick` is omitted: the click handler IS the recipe's behaviour, and
    admitting one would let a call site silently replace the copy. */
type CopyButtonProps_ = CopyButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref" | "onClick">;

export const CopyButton = defineComponent<
  CopyButtonProps_,
  typeof COPYBUTTON_SELECTORS,
  readonly [],
  readonly [],
  HTMLButtonElement
>({
  name: "CopyButton",
  selectors: COPYBUTTON_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
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

    // `render` runs inside the builder's own forwardRef function-component body
    // on every render, so hooks here obey the rules of hooks normally.
    const [copied, setCopied] = useState(false);

    // `stopPropagation` so a copy click inside a clickable row never also fires
    // the row's own click. The optional chain short-circuits the ENTIRE chain
    // (`.then` included) when `clipboard` is nullish, so no defensive `?.then`.
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
        ref={ref}
        type="button"
        aria-label={title}
        title={copied ? "copied" : title}
        {...rest}
        // Non-overridable tail. `onClick` belongs here, not among the defaults
        // above: it is the recipe's whole behaviour, and the type already omits
        // it from the public surface.
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

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const copyButtonTheme = CopyButton.extend({});
