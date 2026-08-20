import type { ComponentProps, HTMLAttributes, Ref } from "react";
import { defineComponent } from "../../builders.ts";
import type { Toast } from "../../hooks/index.ts";
import classes from "./ToastHost.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

/** `root` is the fixed-position stack; `toast` is one entry. */
const TOASTHOST_SELECTORS = ["root", "toast"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
export const TOASTHOST_PARTS = { root: "toasthost", toast: "toasthost-toast" } as const;

/** Verbatim mr-board value. A fixed position offset, outside the spacing
    ladder's padding-margin-gap scope, so it gets a recipe-local property. */
const TOASTHOST_SCALARS: Record<string, string> = {
  "--sb-toasthost-offset": "16px",
};

/** ToastHost's own props; `ToastHostProps` below is the full public surface. */
export interface ToastHostOwnProps {
  /** The live queue, straight from `useToasts()`. Its `Toast` type is imported
      from the hook rather than redeclared, so the two stay one type. */
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
  // Nothing to merge with the builder's automatic autoVars output, which a
  // recipe-supplied resolver replaces: ToastHost declares no `variants`.
  vars: (_theme, _props) => ({ root: { ...TOASTHOST_SCALARS } }),
  render: ({ props, getStyles, ref }) => {
    const {
      toasts,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    // An empty queue renders NOTHING, not a hidden fixed-position box sitting
    // over the page. Safe to early-return: unlike a hook call, `render` is a
    // plain function the builder's always-run component body invokes.
    if (toasts.length === 0) return null;

    return (
      <div
        ref={ref as Ref<HTMLDivElement>}
        role="status"
        aria-live="polite"
        {...rest}
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

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const toastHostTheme = ToastHost.extend({});
