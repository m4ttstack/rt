import { createTheme, defineVocabulary } from "@soribashi/core";
import { tuiIntentResolver } from "./intent-resolver.ts";

/**
 * tui-kit's vocabulary: the board's own words.
 *
 * `intent` is role-named where mr-board's CSS is hue-named (`--accent`,
 * `--green`, ...); src/intent-resolver.ts holds the join. Renames of the board's
 * own class-level vocabulary are deferred per the spec — this axis is the
 * component-prop vocabulary, not the CSS one.
 *
 * `variant` omits soribashi's default `filled`/`link`: nothing in the TUI look
 * paints a filled intent-coloured control, and a variant the kit cannot render
 * has no business in the vocabulary a prop validates against.
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
  variant: defineVocabulary(["outline", "subtle", "ghost"] as const),
};

/**
 * The Tokyo Day / Tokyo Night theme.
 *
 * Every colour value below is mr-board's EXACT string, copied from its
 * `src/style.css` `:root` / `:root.dark` blocks and cross-checked against
 * docs/token-census.md section (a). Parity with the board is by construction,
 * not by eye: no value here was rounded, re-derived, or "cleaned up".
 *
 * One canonical shade (`500`) per hue family. The TUI look has one value per
 * colour, not a ramp; hover and wash derivation happens through `color-mix`
 * (in the intent resolver, and in the wash semantic tokens below), never by
 * inventing ramp shades the source palette never had.
 *
 * Scale-key naming convention (spacing / fontSize / radius): a t-shirt ladder
 * carries the dominant rhythm, and `remNN` / `pxN` rungs carry the exact
 * remaining literals the board actually uses, so recipe CSS can reference a
 * token for any real value instead of half of them. Keys never START with a
 * digit: @soribashi/factory's getSize() treats a digit-leading token key as raw
 * CSS (see get-size.ts's isRawCss), so `spacing["2xs"]` would emit the literal
 * string `2xs` from a style prop rather than `var(--spacing-2xs)`.
 */
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
      surface: { bg: "#e1e2e7", panel: "#eff0f5", card: "#f6f6fa" },
      line: {
        border: "#c8cad6",
        soft: "#d5d7e2",
        grid: "rgba(52, 59, 88, 0.05)",
      },
      dot: { ok: "#1f9d3a", warn: "#e08a00", bad: "#e5153f" },
      // REQUIRED, not optional. createTheme() unconditionally merges its
      // DEFAULT_TEXT / DEFAULT_SURFACE / DEFAULT_BORDER semantic tokens over
      // whatever this theme declares (create-theme.ts, the per-key merge), and
      // those defaults reference colors.neutral.{0,50,100,200,400,600,900}. A
      // theme without a `neutral` family therefore fails codegen validation on
      // references it never wrote. The values mirror the surface/line/gray
      // families above so the backfilled defaults at least resolve to sane TUI
      // colours; no tui recipe reads them (recipes use the explicit semantics
      // below).
      neutral: {
        "0": "#f6f6fa", // = surface.card
        "50": "#eff0f5", // = surface.panel
        "100": "#e1e2e7", // = surface.bg
        "200": "#d5d7e2", // = line.soft
        "400": "#c8cad6", // = line.border
        "600": "#8990b3", // = gray.muted
        "900": "#111", // = gray.fg
      },
    },
    radius: {
      xs: "3px",
      sm: "4px",
      md: "6px",
      lg: "8px",
      xl: "10px",
      round: "50%",
      px2: "2px",
      px5: "5px",
      px7: "7px",
    },
    // The t-shirt ladder is mr-board's 0.15rem grid (0.15 / 0.3 / 0.45 / 0.6 /
    // 0.9 / 1.1, plus the 0.7 step it uses for card padding). The remNN / pxN
    // rungs are every other rem/px padding-margin-gap literal that appears at
    // least twice in the board's `.tui-*` rules (docs/token-census.md section
    // b). `em`-based spacing stays inline in recipe CSS on purpose: it is
    // deliberately relative to the element's own font size and cannot be a
    // global rung.
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
    // `base` is the board's body size (`font: 13.5px/1.55 var(--font-mono)`).
    // The ladder follows usage frequency in the census, not a geometric
    // progression: `md` is 0.76rem because that is the board's most-used font
    // size (8 rules), not because it sits halfway between two neighbours.
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
    fontFamily: {
      mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    // The board's body line-height, the other half of its `font:` shorthand.
    lineHeight: { base: "1.55" },
    shadow: {
      menu: "0 10px 30px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.18)",
      modal: "0 12px 40px rgba(0, 0, 0, 0.25)",
      toast: "0 6px 20px rgba(0, 0, 0, 0.25)",
      drawer: "-6px 0 32px rgba(0, 0, 0, 0.3)",
      "drawer-left": "4px 0 28px rgba(0, 0, 0, 0.3)",
    },
  },
  // Colours only. mr-board's `:root.dark` carries 17 variables and never
  // redeclares `--font-mono` / `--font-sans`; soribashi rejects a non-colour
  // dark override outright (light-dark() is a <color> production), so the two
  // constraints agree.
  dark: {
    colors: {
      blue: { "500": "#7aa2f7" },
      green: { "500": "#9ece6a" },
      red: { "500": "#f7768e" },
      amber: { "500": "#e0af68" },
      purple: { "500": "#bb9af7" },
      cyan: { "500": "#7dcfff" },
      gray: { fg: "#e3e7f6", muted: "#7e86ad" },
      surface: { bg: "#16161e", panel: "#232a47", card: "#2c3352" },
      line: {
        border: "#3b4261",
        soft: "#313853",
        grid: "rgba(122, 162, 247, 0.06)",
      },
      dot: { ok: "#4ade5b", warn: "#ffbb3d", bad: "#ff5c72" },
      neutral: {
        "0": "#2c3352",
        "50": "#232a47",
        "100": "#16161e",
        "200": "#313853",
        "400": "#3b4261",
        "600": "#7e86ad",
        "900": "#e3e7f6",
      },
    },
  },
  semanticTokens: {
    surface: {
      canvas: "colors.surface.bg",
      panel: "colors.surface.panel",
      card: "colors.surface.card",
      // The wash layers: every distinct `color-mix()` expression in mr-board's
      // stylesheet (docs/token-census.md section (c), all 16), carried as RAW
      // strings. validate-theme.ts's validateRef only checks values that match
      // its dotted-identifier REF_SHAPE, so an expression like this one passes
      // through and emitCss writes it verbatim (same route DEFAULT_SURFACE's
      // `overlay` scrim takes).
      //
      // They mix the ALIAS names (`var(--panel)`, `var(--accent)`, ...) rather
      // than the underlying `--surface-panel` / `--color-blue-500` for two
      // reasons: the strings then match the board's CSS byte for byte, and a
      // consumer who re-points an alias re-points its washes with it. Custom
      // property references resolve at use, not in declaration order, so it
      // does not matter that the aliases are emitted later in the same block.
      "wash-bg-55": "color-mix(in srgb, var(--bg) 55%, transparent)",
      "wash-panel-55": "color-mix(in srgb, var(--panel) 55%, transparent)",
      "wash-panel-70": "color-mix(in srgb, var(--panel) 70%, transparent)",
      "wash-panel-88": "color-mix(in srgb, var(--panel) 88%, transparent)",
      "wash-panel-94": "color-mix(in srgb, var(--panel) 94%, transparent)",
      // 100% of a colour mixed with transparent is that colour — kept because
      // the board writes it (a deliberate "same shape as its siblings, no
      // translucency here" marker), and verbatim means verbatim.
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
    // Plain string refs: SemanticTokensConfig types `text` and `border` as
    // Record<string, SemanticReference>. Only `surface` accepts the object form.
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
