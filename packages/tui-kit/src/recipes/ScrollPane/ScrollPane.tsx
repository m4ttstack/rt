import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./ScrollPane.module.css";

/** Authoring category (1 = pure styled primitive). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 1 as const;

const SCROLLPANE_SELECTORS = ["root", "head", "body"] as const;

export const SCROLLPANE_PARTS = {
  root: "scrollpane",
  head: "scrollpane-head",
  body: "scrollpane-body",
} as const;

export interface ScrollPaneOwnProps {
  /** Pinned header content, rendered in the band above the scrolling body. */
  title: ReactNode;
  /** CSS max-height for the whole pane (e.g. "46vh"). Omitted = uncapped. */
  maxHeight?: string;
  children?: ReactNode;
}

type ScrollPaneProps_ = ScrollPaneOwnProps &
  Omit<HTMLAttributes<HTMLElement>, "ref" | "children" | "title">;

export const ScrollPane = defineComponent<
  ScrollPaneProps_,
  typeof SCROLLPANE_SELECTORS,
  readonly [],
  readonly []
>({
  name: "ScrollPane",
  selectors: SCROLLPANE_SELECTORS,
  classes,
  vars: (_theme, props) => ({
    root: {
      "--sb-scrollpane-max": (props as ScrollPaneOwnProps).maxHeight ?? "none",
    },
  }),
  render: ({ props, getStyles, ref }) => {
    const {
      title,
      maxHeight: _maxHeight,
      children,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    return (
      <section
        ref={ref}
        {...rest}
        {...getStyles("root")}
        data-part={SCROLLPANE_PARTS.root}
      >
        <div {...getStyles("head")} data-part={SCROLLPANE_PARTS.head}>
          {title}
        </div>
        <div {...getStyles("body")} data-part={SCROLLPANE_PARTS.body}>
          {children}
        </div>
      </section>
    );
  },
});

export type ScrollPaneProps = ComponentProps<typeof ScrollPane>;

export const scrollPaneTheme = ScrollPane.extend({});
