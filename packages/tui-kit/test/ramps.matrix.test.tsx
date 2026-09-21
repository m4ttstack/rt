import {
  contrastRatio,
  installNoTransitionStyle,
  NO_TRANSITION_CLASS,
  resolveCanvasColor,
  toRgbString,
} from "@soribashi/core/testing";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { render } from "vitest-browser-react/pure";
import {
  FILL_DEBT_BY_KEY,
  fillDebtKey,
  LINE_DEBT_BY_KEY,
  lineDebtKey,
  ON_FILL_DEBT_BY_KEY,
  onFillDebtKey,
  VIVID_TEXT_DEBT_BY_KEY,
  vividTextDebtKey,
} from "../src/a11y/known-contrast-debt.ts";
import { TuiKitProvider } from "../src/provider.tsx";

const SURFACES = [1, 2, 3, 4] as const;
const TEXT_BAR: Record<number, number> = { 1: 7.0, 2: 4.5, 3: 4.8, 4: 7.0 };
const HUES = ["accent", "ok", "bad", "warn", "purple", "cyan", "gold"] as const;
const SCHEMES = ["light", "dark"] as const;
const FILL_BAR = 3.0;
const TEXT_LABEL_BAR = 4.5;
const GLYPH_BAR = 3.0;

function id(kind: string, a: string | number, b: string | number) {
  return `ramp-${kind}-${a}-on-${b}`;
}

describe("ramp contrast matrix (text steps, hue text, on-fill labels and fills against every surface, both schemes)", () => {
  let container: HTMLDivElement;
  let removeNoTransitionStyle: () => void;

  beforeAll(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    removeNoTransitionStyle = installNoTransitionStyle();
    container.classList.add(NO_TRANSITION_CLASS);

    await render(
      <TuiKitProvider>
        {SURFACES.map((s) => (
          <div key={s} data-testid={id("surface", s, "root")} style={{ background: `var(--surface-${s})`, padding: 8 }}>
            {SURFACES.map((t) => (
              <span key={t} data-testid={id("text", t, s)} style={{ color: `var(--text-${t})` }}>
                text
              </span>
            ))}
            {HUES.map((h) => (
              <span key={h} data-testid={id("hue", h, s)} style={{ color: `var(--text-${h})` }}>
                text
              </span>
            ))}
            {HUES.map((h) => (
              <span key={`${h}-small`} data-testid={id("hue-small", h, s)} style={{ color: `var(--text-${h}-small)` }}>
                text
              </span>
            ))}
            {HUES.map((h) => (
              <span key={`${h}-vivid`} data-testid={id("hue-vivid", h, s)} style={{ color: `var(--text-${h}-vivid)` }}>
                text
              </span>
            ))}
            {HUES.map((h) => (
              <span key={`${h}-fill`} data-testid={id("fill", h, s)} style={{ background: `var(--fill-${h})`, display: "inline-block", width: 12, height: 12 }} />
            ))}
            <span data-testid={id("fill", "line-1", s)} style={{ background: "var(--line-1)", display: "inline-block", width: 12, height: 12 }} />
          </div>
        ))}
        {HUES.map((h) => (
          <span
            key={`${h}-on-fill`}
            data-testid={id("on-fill", h, "fill")}
            style={{ background: `var(--fill-${h})`, color: `var(--on-fill-${h})` }}
          >
            label
          </span>
        ))}
      </TuiKitProvider>,
      { container },
    );
  });

  afterAll(() => {
    container.remove();
    removeNoTransitionStyle();
  });

  function el(testId: string): HTMLElement {
    const node = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!node) throw new Error(`ramp matrix: nothing rendered for "${testId}"`);
    return node;
  }

  function textRatio(testId: string, surface: number): number {
    const fg = toRgbString(getComputedStyle(el(testId)).color);
    const bg = toRgbString(getComputedStyle(el(id("surface", surface, "root"))).backgroundColor);
    return contrastRatio(fg, bg, resolveCanvasColor(container));
  }

  function fillRatio(hue: string, surface: number): number {
    const fill = toRgbString(getComputedStyle(el(id("fill", hue, surface))).backgroundColor);
    const bg = toRgbString(getComputedStyle(el(id("surface", surface, "root"))).backgroundColor);
    return contrastRatio(fill, bg);
  }

  function onFillRatio(hue: string): number {
    const cs = getComputedStyle(el(id("on-fill", hue, "fill")));
    return contrastRatio(toRgbString(cs.color), toRgbString(cs.backgroundColor));
  }

  function assertScheme(scheme: (typeof SCHEMES)[number]) {
    for (const s of SURFACES) {
      for (const t of SURFACES) {
        const ratio = textRatio(id("text", t, s), s);
        expect(ratio, `${scheme} text-${t} on surface-${s} ratio=${ratio.toFixed(3)}`).toBeGreaterThanOrEqual(TEXT_BAR[t]!);
      }
      {
        const line = fillRatio("line-1", s);
        const label = `${scheme} line-1 on surface-${s} ratio=${line.toFixed(3)}`;
        const debt = LINE_DEBT_BY_KEY.get(lineDebtKey({ scheme, surface: s }));
        if (debt) {
          expect(line, `${label} regressed below its known-contrast-debt.ts floor`).toBeGreaterThanOrEqual(debt.measuredRatio - 0.05);
          expect(line, `${label} cleared ${FILL_BAR}; remove its entry`).toBeLessThan(FILL_BAR);
        } else {
          expect(line, label).toBeGreaterThanOrEqual(FILL_BAR);
        }
      }
      for (const h of HUES) {
        const small = textRatio(id("hue-small", h, s), s);
        expect(small, `${scheme} text-${h}-small on surface-${s} ratio=${small.toFixed(3)}`).toBeGreaterThanOrEqual(7.0);

        // `--text-<hue>` and `--text-<hue>-vivid` are the same value: step 11
        // is the default hue text and the vivid name is kept only so the
        // consumers that pinned it keep resolving. Both elements are rendered
        // and both are asserted, so the alias cannot drift from its source.
        const body = textRatio(id("hue", h, s), s);
        const vivid = textRatio(id("hue-vivid", h, s), s);
        expect(vivid, `${scheme} text-${h}-vivid diverged from text-${h}`).toBeCloseTo(body, 2);

        // Two bars apply to the same step. A glyph reads it everywhere and
        // must never fall under 3.0. Running text reads it at 4.5, and that
        // promise is ledgered per surface, because Radix designs step 11
        // against ITS grounds (steps 1 to 2 on a near-white page) and ours
        // are slate 2 to 4.
        expect(
          body,
          `${scheme} text-${h} on surface-${s} ratio=${body.toFixed(3)} under the ${GLYPH_BAR} glyph bar`,
        ).toBeGreaterThanOrEqual(GLYPH_BAR);
        const textDebt = VIVID_TEXT_DEBT_BY_KEY.get(vividTextDebtKey({ hue: h, scheme, surface: s }));
        const textLabel = `${scheme} text-${h} on surface-${s} ratio=${body.toFixed(3)} as text (${TEXT_LABEL_BAR})`;
        if (textDebt) {
          expect(body, `${textLabel} regressed below its known-contrast-debt.ts floor`).toBeGreaterThanOrEqual(
            textDebt.measuredRatio - 0.05,
          );
          expect(body, `${textLabel} cleared ${TEXT_LABEL_BAR}; remove this cell's entry from known-contrast-debt.ts`).toBeLessThan(
            TEXT_LABEL_BAR,
          );
        } else {
          expect(body, textLabel).toBeGreaterThanOrEqual(TEXT_LABEL_BAR);
        }
        const fill = fillRatio(h, s);
        const label = `${scheme} fill-${h} on surface-${s} ratio=${fill.toFixed(3)}`;
        const debt = FILL_DEBT_BY_KEY.get(fillDebtKey({ hue: h, scheme }));
        if (debt) {
          expect(fill, `${label} regressed below its known-contrast-debt.ts floor (${debt.measuredRatio} - 0.05)`).toBeGreaterThanOrEqual(debt.measuredRatio - 0.05);
          if (s === 4) {
            expect(fill, `${label} cleared ${FILL_BAR}; remove this fill's entry from known-contrast-debt.ts`).toBeLessThan(FILL_BAR);
          }
        } else {
          expect(fill, label).toBeGreaterThanOrEqual(FILL_BAR);
        }
      }
    }

    // The fill ledger keys one entry per (scheme, hue) and runs its removal
    // check only on surface-4, on the premise that surface-4 is every fill's
    // worst ground. Assert the premise, so a surface-ramp re-tune that moves
    // the worst cell elsewhere fails here instead of slipping past the key.
    for (const h of HUES) {
      const worst = fillRatio(h, 4);
      for (const s of SURFACES) {
        expect(
          worst,
          `${scheme} fill-${h}: surface-4 (${worst.toFixed(3)}) must be the worst surface, but surface-${s} measures ${fillRatio(h, s).toFixed(3)}`,
        ).toBeLessThanOrEqual(fillRatio(h, s) + 1e-9);
      }
    }

    for (const h of HUES) {
      const ratio = onFillRatio(h);
      const label = `${scheme} on-fill-${h} on fill-${h} ratio=${ratio.toFixed(3)}`;
      const debt = ON_FILL_DEBT_BY_KEY.get(onFillDebtKey({ hue: h, scheme }));
      if (debt) {
        expect(ratio, `${label} regressed below its known-contrast-debt.ts floor`).toBeGreaterThanOrEqual(debt.measuredRatio - 0.05);
        expect(ratio, `${label} cleared ${TEXT_LABEL_BAR}; remove this cell's entry from known-contrast-debt.ts`).toBeLessThan(
          TEXT_LABEL_BAR,
        );
      } else {
        expect(ratio, label).toBeGreaterThanOrEqual(TEXT_LABEL_BAR);
      }
    }
  }

  describe("light scheme", () => {
    test("every cell clears its bar or matches its ledger entry", () => assertScheme("light"));
  });

  describe("dark scheme", () => {
    beforeAll(() => {
      container.classList.add("dark");
      void container.offsetHeight;
    });
    afterAll(() => {
      container.classList.remove("dark");
    });
    test("every cell clears its bar or matches its ledger entry", () => assertScheme("dark"));
  });
});
