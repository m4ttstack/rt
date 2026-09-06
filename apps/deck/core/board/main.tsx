import { createRoot } from "react-dom/client";
import { SoribashiProvider } from "@mattstack/tui-kit/provider";
import { tuiTheme } from "@mattstack/tui-kit/theme";
import "@mattstack/tui-kit/theme.css";
import "./board.css";
import { Board } from "./Board.tsx";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyScheme() {
  document.documentElement.classList.toggle("dark", darkQuery.matches);
}
applyScheme();
darkQuery.addEventListener("change", applyScheme);

createRoot(document.getElementById("root")!).render(
  <SoribashiProvider theme={tuiTheme}>
    <Board />
  </SoribashiProvider>,
);
