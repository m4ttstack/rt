import { registerTheme, SoribashiProvider } from "@soribashi/core";
import type { ReactNode } from "react";
import { tuiTheme } from "./theme.ts";

/**
 * The kit's app-entry wiring, `@mattstack/tui-kit/provider`.
 *
 * An adopter MUST reach soribashi's provider through the kit rather than
 * importing `@soribashi/core` directly: bundlers key module identity by
 * resolved path, and an adopter's own `@soribashi/core` resolves down a
 * different path than the kit's files do, yielding two `SoribashiContext`
 * objects and a silent fallback to the DEFAULT theme. See docs/decisions.md.
 *
 * `registerTheme` runs here at module scope so that importing the provider
 * is enough for style-prop resolvers, which read the registry rather than
 * React context; `TuiKitProvider` supplies the context half.
 */
registerTheme(tuiTheme);

export function TuiKitProvider({ children }: { children: ReactNode }) {
  return <SoribashiProvider theme={tuiTheme}>{children}</SoribashiProvider>;
}

export { registerTheme, SoribashiProvider };
