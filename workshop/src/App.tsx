import type { ComponentType } from "react";
import { useState } from "react";
import { Chips } from "./pages/Chips.tsx";
import { CopyButtons } from "./pages/CopyButtons.tsx";
import { Icons } from "./pages/Icons.tsx";
import { Segmenteds } from "./pages/Segmenteds.tsx";
import { Tokens } from "./pages/Tokens.tsx";

/**
 * Page-registration table. Each key is both the sidebar identity and the
 * displayed label's source (title-cased below); recipe tasks 8-15 each add
 * one entry here as their page arrives.
 *
 * `tokens` stays FIRST: the default page is `Object.keys(PAGES)[0]`, and the
 * token audit is the right landing page. Recipe pages are appended after it in
 * alphabetical order.
 */
const PAGES: Record<string, ComponentType> = {
  tokens: Tokens,
  chips: Chips,
  copybuttons: CopyButtons,
  icons: Icons,
  segmenteds: Segmenteds,
};

/** Per-key label overrides for the naive capitalize-first-letter default
 * below — needed once a key isn't a single word (`copybuttons`). */
const PAGE_LABELS: Record<string, string> = {
  copybuttons: "CopyButton",
};

function pageLabel(key: string): string {
  return PAGE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export function App() {
  const [activeKey, setActiveKey] = useState<string>(Object.keys(PAGES)[0] ?? "tokens");
  const [dark, setDark] = useState(false);
  const ActivePage = PAGES[activeKey];

  // The theme's dark mechanism is light-dark() + `color-scheme`, driven
  // entirely off the `.dark` class on <html> (src/theme.ts's
  // `darkMode: { selector: ".dark" }`) — flipping the class is the whole
  // toggle, no other wiring needed.
  function toggleDark() {
    document.documentElement.classList.toggle("dark");
    setDark((value) => !value);
  }

  return (
    <div className="workshop-shell">
      <nav className="workshop-sidebar">
        <div className="workshop-sidebar-header">
          <span className="workshop-title">tui-kit workshop</span>
          <button type="button" onClick={toggleDark}>
            {dark ? "Light" : "Dark"}
          </button>
        </div>
        {Object.keys(PAGES).map((key) => (
          <button
            key={key}
            type="button"
            className={key === activeKey ? "workshop-nav-active" : undefined}
            onClick={() => setActiveKey(key)}
          >
            {pageLabel(key)}
          </button>
        ))}
      </nav>
      <main className="workshop-main">{ActivePage ? <ActivePage /> : null}</main>
    </div>
  );
}
