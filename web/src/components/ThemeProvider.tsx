import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** The actually-applied mode after resolving "system". */
  resolved: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "forge-theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyClass(resolved: "light" | "dark"): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
}

/**
 * Minimal theme provider for a Vite SPA (no next-themes needed). Defaults to "system" and
 * remembers an explicit choice in localStorage. Toggling re-applies the `.dark` class on
 * <html>, which is what the design tokens key off.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system",
  );
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    (theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme),
  );

  useEffect(() => {
    const next = theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
    setResolved(next);
    applyClass(next);
  }, [theme]);

  // Follow the OS when in "system" mode.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = mq.matches ? "dark" : "light";
      setResolved(next);
      applyClass(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  };

  return <ThemeContext.Provider value={{ theme, setTheme, resolved }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
