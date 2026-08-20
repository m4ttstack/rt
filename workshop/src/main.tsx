// Through the kit's own `/provider` subpath, not `@soribashi/core` directly —
// the shape every adopter is told to use (README, "Wiring an adopter app"), so
// the workshop is a live surface check for that export the same way it is for
// the barrel. It also keeps these two on the SAME resolved path as `tuiTheme`
// and every recipe, which is the whole point of the subpath: see
// `src/provider.ts` for why two paths mean two SoribashiContexts.
import { registerTheme, SoribashiProvider } from "@mattstack/tui-kit/provider";
import { tuiTheme } from "@mattstack/tui-kit/theme";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
// Plain relative paths, not the `@mattstack/tui-kit` alias: see
// vite.config.ts's comment for why these two specifically can't go through
// it (their package.json export names don't echo their real src/ location).
import "../../src/generated/theme.css";
import "../../src/canvas.css";
import "./styles.css";

// MANDATORY, not decoration. registerTheme() is what @soribashi/factory's
// makeBuilders()-produced components (src/builders.ts) read at render time to
// resolve tokens/vocabulary/intent; skip it and every style-prop lookup falls
// through to whatever theme — if any — some OTHER import happened to register
// first. This is a known soribashi-docs trap: their own apps/workshop/src/
// main.tsx never calls it (SORI-13), and only gets away with it because
// @soribashi/ui's own ButtonPage etc. all import from a package that
// registers its theme on module load. @mattstack/tui-kit has no such
// fallback, so a workshop that forgot this call would render, but every
// component's resolved styling would be silently wrong.
registerTheme(tuiTheme);

const container = document.getElementById("root");
if (!container) {
  throw new Error("workshop: #root element not found");
}

createRoot(container).render(
  <StrictMode>
    <SoribashiProvider theme={tuiTheme}>
      <App />
    </SoribashiProvider>
  </StrictMode>,
);
