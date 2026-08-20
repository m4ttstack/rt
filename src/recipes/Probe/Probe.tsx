import type { ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Probe.module.css";

/**
 * TEMPORARY. Probe exists only to prove the test rig this task builds — both
 * vitest tiers, both mechanical CSS gates, and the browser-mode launch — and is
 * deleted in this same commit series. Task 8's Icon is the kit's first real
 * recipe. Do not build on this.
 */
export const recipeCategory = 1 as const;

export interface ProbeProps {
  children?: ReactNode;
}

export const Probe = defineComponent<ProbeProps>({
  name: "Probe",
  selectors: ["root"] as const,
  classes,
  render: ({ props, getStyles, ref }) => {
    const {
      children,
      classNames: _cn,
      styles: _st,
      vars: _v,
      attributes: _at,
      unstyled: _un,
      ...rest
    } = props as ProbeProps & Record<string, unknown>;
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} {...rest} {...getStyles("root")}>
        {children}
      </div>
    );
  },
});
