import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerTheme, SoribashiProvider } from "@mattstack/tui-kit/provider";
import { tuiTheme } from "@mattstack/tui-kit/theme";
// The board's design tokens and page canvas now come from the kit, not from
// src/style.css: theme.css carries the `:root` token block (light values via
// `light-dark()`, dark flipped by `.dark { color-scheme: dark }` -- the same
// `dark` class the shell's inline script toggles on <html>), and canvas.css
// carries `* { box-sizing }`, the body ground, and `.tui`/`.tui-wide`.
// Bun.build emits both into the CSS chunk the shell links as /app.css, ahead
// of /style.css so the board's own unlayered rules still win.
import "@mattstack/tui-kit/theme.css";
import "@mattstack/tui-kit/canvas.css";
import { Board } from "./board/Board.tsx";

// Both halves are load-bearing and neither substitutes for the other:
// registerTheme() is what @soribashi/factory's style-prop resolvers read at
// module scope, while <SoribashiProvider> is what useTheme() reads inside the
// tree. Without them a kit recipe's intent props resolve through the DEFAULT
// resolver and emit token refs this theme never defines.
//
// Imported from `@mattstack/tui-kit/provider`, never `@soribashi/core`: that
// keeps them on the same resolved path as `tuiTheme` and every recipe, which
// is what makes them the SAME module instance. The kit's `src/provider.ts`
// carries the why.
registerTheme(tuiTheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SoribashiProvider theme={tuiTheme}>
      <Board />
    </SoribashiProvider>
  </StrictMode>,
);
