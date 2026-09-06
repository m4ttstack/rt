import { createTheme, defineVocabulary } from "@soribashi/core";
import { tuiIntentResolver } from "./intent-resolver.ts";

/**
 * `intent` is role-named where mr-board's CSS is hue-named; the join lives in
 * src/intent-resolver.ts. `variant` is soribashi 0.2.0's canonical vocabulary
 * minus `transparent`/`link`: nothing in the TUI look paints those, and a
 * variant the kit cannot render has no business in the vocabulary a prop
 * validates against. `default` (Button's own default) is not a neutral
 * afterthought — it IS the resolver's `default` branch: a NEUTRAL opaque
 * panel, the same box CopyButton already renders — see Button.module.css.
 */
export const tuiVocabulary = {
  size: defineVocabulary(["xs", "sm", "md", "lg", "xl"] as const),
  intent: defineVocabulary([
    "accent",
    "ok",
    "warn",
    "bad",
    "cyan",
    "purple",
    "muted",
  ] as const),
  variant: defineVocabulary(["default", "light", "outline", "subtle"] as const),
};

/**
 * The Tokyo Day / Tokyo Night theme.
 *
 * EVERY VALUE BELOW IS MR-BOARD'S EXACT STRING, cross-checked against
 * docs/token-census.md. Nothing here may be rounded, re-derived, or "cleaned
 * up" — parity with the board is by construction, not by eye.
 *
 * One canonical shade (`500`) per hue family: the TUI look has one value per
 * colour, not a ramp. See docs/decisions.md for the census methodology and the
 * scale-key naming rule (keys must never start with a digit — `getSize()`
 * treats a digit-leading key as raw CSS).
 */
/** The night palette, exported so scheme-INVARIANT surfaces (the always-dark
    terminal treatment) can alias these exact values: every scheme-varying
    token collapses its light-dark() once at :root, so no var() chain can pin
    a leaf element to the dark branch while the page is in day scheme. */
export const TUI_DARK_COLORS = {
  blue: { "500": "#7aa2f7" },
  green: { "500": "#9ece6a" },
  red: { "500": "#f7768e" },
  amber: { "500": "#e0af68" },
  purple: { "500": "#bb9af7" },
  cyan: { "500": "#7dcfff" },
  gray: { fg: "#e3e7f6", muted: "#7e86ad" },
  surface: { bg: "#16161e", panel: "#232a47", card: "#2c3352", chrome: "#232a47" },
  line: {
    border: "#3b4261",
    soft: "#313853",
    grid: "rgba(122, 162, 247, 0.06)",
  },
  dot: { ok: "#4ade5b", warn: "#ffbb3d", bad: "#ff5c72" },
} as const;

export const tuiTheme = createTheme({
  name: "tui-kit",
  darkMode: { selector: ".dark" },
  intentResolver: tuiIntentResolver,
  vocabulary: tuiVocabulary,
  tokens: {
    colors: {
      blue: { "500": "#2e7de9" },
      green: { "500": "#587539" },
      red: { "500": "#f52a65" },
      amber: { "500": "#8c6c3e" },
      purple: { "500": "#7847bd" },
      cyan: { "500": "#007197" },
      gray: { fg: "#111", muted: "#8990b3" },
      surface: { bg: "#f7f8fa", panel: "#fbfbfc", card: "#ffffff", chrome: "#f3f4f7" },
      line: {
        border: "#c8cad6",
        soft: "#d5d7e2",
        grid: "rgba(52, 59, 88, 0.05)",
      },
      dot: { ok: "#1f9d3a", warn: "#e08a00", bad: "#e5153f" },
    },
    radius: {
      xs: "3px",
      sm: "4px",
      md: "6px",
      lg: "8px",
      xl: "10px",
      // `round` (50%) is correct only on a box whose width equals its
      // height (StatusDot's dot, Spinner's ring) — on a wider box it draws
      // an ellipse. `pill` is a fixed radius past any realistic box's own
      // half-height, so it always resolves to a true stadium regardless of
      // the box's aspect ratio (Badge's root, Switch's track).
      round: "50%",
      pill: "999px",
      px2: "2px",
      px5: "5px",
      px7: "7px",
    },
    // `em`-based spacing is deliberately absent and stays in recipe CSS: an em
    // is relative to the element's own font size and cannot be a global rung.
    //
    // `xxs`/`xxl` stay as they are. SORI-6 (getSize() mis-reading a
    // digit-leading key as raw CSS) is fixed upstream, so `2xs`/`2xl` would now
    // work — but renaming churns every emitted variable and every recipe
    // reference for zero behavioural gain.
    spacing: {
      xxs: "0.15rem",
      xs: "0.3rem",
      sm: "0.45rem",
      md: "0.6rem",
      lg: "0.7rem",
      xl: "0.9rem",
      xxl: "1.1rem",
      rem20: "0.2rem",
      rem35: "0.35rem",
      rem40: "0.4rem",
      rem50: "0.5rem",
      rem55: "0.55rem",
      rem75: "0.75rem",
      rem80: "0.8rem",
      rem100: "1rem",
      rem120: "1.2rem",
      rem140: "1.4rem",
      rem150: "1.5rem",
      // The iconOnly Button's min square (Button.module.css) — the old Oat
      // board's `min-height: 1.75rem` guard against a cramped glyph box,
      // carried into the token scale rather than left as a recipe literal.
      rem175: "1.75rem",
      rem180: "1.8rem",
      px2: "2px",
      px3: "3px",
      px4: "4px",
      px5: "5px",
      px6: "6px",
      px7: "7px",
      px8: "8px",
      px9: "9px",
      px10: "10px",
      px12: "12px",
      px14: "14px",
    },
    // The ladder follows census usage frequency, not a geometric progression:
    // `md` is 0.76rem because that is the board's most-used size, not because
    // it sits halfway between its neighbours.
    fontSize: {
      base: "13.5px",
      xxs: "0.55rem",
      xs: "0.66rem",
      sm: "0.7rem",
      md: "0.76rem",
      lg: "0.85rem",
      xl: "0.92rem",
      xxl: "1.15rem",
      rem60: "0.6rem",
      rem65: "0.65rem",
      rem68: "0.68rem",
      rem72: "0.72rem",
      rem74: "0.74rem",
      rem75: "0.75rem",
      rem78: "0.78rem",
      rem80: "0.8rem",
      rem82: "0.82rem",
      rem90: "0.9rem",
      rem95: "0.95rem",
      rem100: "1rem",
      rem105: "1.05rem",
      px9: "9px",
      px10: "10px",
      px11: "11px",
      px12: "12px",
      px13: "13px",
    },
    // `sans` carries UI/body text in the system sans; `mono` stays vendored
    // JetBrains Mono for code, tabular numbers, and data tables. (Both slots
    // were monospace, which was fatiguing for long-form UI prose -- see
    // test/theme.test.ts's font block.)
    // One variable woff2 under assets/fonts/ covers weights 100-800 for the
    // mono face; the @font-face rule pointing at it is appended to
    // src/generated/theme.css by scripts/append-font-faces.ts, run as the
    // second half of the `codegen` script.
    fontFamily: {
      mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    lineHeight: { base: "1.55" },
    shadow: {
      menu: "0 10px 30px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.18)",
      modal: "0 12px 40px rgba(0, 0, 0, 0.25)",
      toast: "0 6px 20px rgba(0, 0, 0, 0.25)",
      drawer: "-6px 0 32px rgba(0, 0, 0, 0.3)",
      "drawer-left": "4px 0 28px rgba(0, 0, 0, 0.3)",
    },
  },
  // Colours only: soribashi rejects a non-colour dark override outright
  // (light-dark() is a <color> production), and mr-board's `:root.dark` never
  // redeclares a non-colour either, so the two constraints agree.
  dark: {
    colors: TUI_DARK_COLORS,
  },
  semanticTokens: {
    // No backfill: createTheme's DEFAULT_TEXT / DEFAULT_SURFACE /
    // DEFAULT_BORDER reference a `neutral` colour ramp this palette does not
    // have (one canonical value per hue, no ramp). This theme owns its whole
    // semantic layer, so every slot the recipes read is declared below.
    defaults: false,
    surface: {
      canvas: "colors.surface.bg",
      panel: "colors.surface.panel",
      card: "colors.surface.card",
      chrome: "colors.surface.chrome",
      // Every distinct `color-mix()` expression in mr-board's stylesheet,
      // carried as RAW strings (validateRef only checks dotted-identifier
      // refs, so these pass through and emitCss writes them verbatim).
      //
      // They mix the ALIAS names rather than the underlying tokens so the
      // strings match the board's CSS byte for byte, and so a consumer who
      // re-points an alias re-points its washes with it. Custom properties
      // resolve at use, so the aliases being emitted later does not matter.
      "wash-bg-55": "color-mix(in srgb, var(--bg) 55%, transparent)",
      "wash-panel-55": "color-mix(in srgb, var(--panel) 55%, transparent)",
      "wash-panel-70": "color-mix(in srgb, var(--panel) 70%, transparent)",
      "wash-panel-88": "color-mix(in srgb, var(--panel) 88%, transparent)",
      "wash-panel-94": "color-mix(in srgb, var(--panel) 94%, transparent)",
      // A no-op mix, kept because the board writes it: verbatim means verbatim.
      "wash-panel-100": "color-mix(in srgb, var(--panel) 100%, transparent)",
      "wash-accent-7": "color-mix(in srgb, var(--accent) 7%, transparent)",
      "wash-accent-14": "color-mix(in srgb, var(--accent) 14%, transparent)",
      "wash-accent-16": "color-mix(in srgb, var(--accent) 16%, transparent)",
      "wash-accent-fg-70": "color-mix(in srgb, var(--accent) 70%, var(--fg))",
      "wash-amber-7": "color-mix(in srgb, var(--amber) 7%, transparent)",
      "wash-amber-45": "color-mix(in srgb, var(--amber) 45%, transparent)",
      "wash-fg-5": "color-mix(in srgb, var(--fg) 5%, transparent)",
      "wash-fg-8": "color-mix(in srgb, var(--fg) 8%, transparent)",
      "wash-cyan-panel-38": "color-mix(in srgb, var(--cyan) 38%, var(--panel))",
      "wash-cyan-border-45":
        "color-mix(in srgb, var(--cyan) 45%, var(--border))",
    },
    // Plain string refs only: `text` and `border` are typed
    // Record<string, SemanticReference>; only `surface` accepts the object form.
    text: {
      primary: "colors.gray.fg",
      muted: "colors.gray.muted",
    },
    border: {
      default: "colors.line.border",
      soft: "colors.line.soft",
    },
  },
});
