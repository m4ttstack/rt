import { useEffect, useRef, useState } from "react";

/**
 * mr-board's alias contract, verbatim (docs/token-census.md section (a),
 * "19 variables" — 19 in light, and dark redeclares all but the two font
 * vars, which never change between schemes). These are the SHORT names
 * mr-board's own CSS reads directly (`var(--accent)`, `var(--bg)`, ...), not
 * the longer `--color-*` / `--surface-*` names src/generated/theme.css
 * derives them from — this page is a read-only check that every alias still
 * resolves, under both schemes, to what the census recorded.
 */
const ALIAS_VARS = [
  "--font-mono",
  "--font-sans",
  "--bg",
  "--panel",
  "--border",
  "--border-soft",
  "--fg",
  "--muted",
  "--accent",
  "--card",
  "--green",
  "--red",
  "--amber",
  "--purple",
  "--cyan",
  "--grid-line",
  "--dot-ok",
  "--dot-warn",
  "--dot-bad",
];

// The two font vars are not scheme-dependent (docs/token-census.md: dark
// never redeclares --font-mono/--font-sans), and there is no real CSS
// property to bounce them through the way COLOR_VARS use `backgroundColor`
// below, so they read straight off the custom property's own text.
const FONT_VARS = new Set(["--font-mono", "--font-sans"]);

export function Tokens() {
  const swatchRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [resolved, setResolved] = useState<Record<string, string>>({});

  useEffect(() => {
    function readAll() {
      const next: Record<string, string> = {};
      for (const name of ALIAS_VARS) {
        if (FONT_VARS.has(name)) {
          next[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
          continue;
        }
        // NOT `getComputedStyle(root).getPropertyValue(name)`. A custom
        // property's computed value is its SPECIFIED token text — Chrome
        // (and every other engine) returns the literal
        // "light-dark(#e1e2e7, #16161e)" string back unresolved, regardless
        // of which scheme is active, because `light-dark()` only resolves
        // when consumed by a property that is actually typed as <color>
        // (these vars carry no `@property … syntax: "<color>"` registration,
        // unlike this theme's radius/spacing vars, which DO get `@property`
        // and so WOULD resolve this way). Reading the swatch element's own
        // `backgroundColor` instead — a real, typed CSS property the browser
        // has already resolved against the current `color-scheme` — is what
        // makes this column change when the toggle does.
        const el = swatchRefs.current[name];
        next[name] = el ? getComputedStyle(el).backgroundColor : "";
      }
      setResolved(next);
    }

    readAll();
    const observer = new MutationObserver(readAll);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      <h1>Tokens</h1>
      <p>
        The alias contract's 19 variables: each row is the variable's own{" "}
        <code>var()</code> swatch next to the value <code>getComputedStyle</code>{" "}
        resolves it to right now. Toggle Dark in the sidebar — every row
        should update.
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          marginTop: "1.5rem",
        }}
      >
        {ALIAS_VARS.map((name) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div
              ref={(el) => {
                swatchRefs.current[name] = el;
              }}
              style={{
                width: "3rem",
                height: "3rem",
                flexShrink: 0,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                // Not every alias is a colour (--font-mono, --font-sans):
                // `background` silently ignores those invalid values, so
                // those two rows show an empty swatch next to their (still
                // correct) resolved string rather than a fabricated colour.
                background: `var(${name})`,
              }}
            />
            <div>
              <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{name}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                {resolved[name] ?? "…"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
