import { registerTheme, SoribashiProvider } from "@soribashi/core";
import {
  cellId,
  contrastRatio,
  installNoTransitionStyle,
  MIN_CONTRAST,
  NO_TRANSITION_CLASS,
  resolveCanvasColor,
  toRgbString,
} from "@soribashi/core/testing";
import type { ReactNode } from "react";
import { Fragment } from "react";
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { page } from "vitest/browser";
// `/pure`, not `vitest-browser-react`'s main entry: the main entry
// side-effect-registers a FILE-WIDE `beforeEach(() => cleanup())` on import,
// which would unmount the grid `describe` block's single `beforeAll` mount
// before its first `test.each` case runs (confirmed by a throwaway repro:
// mixing the two entry points in one file left `document.body` empty by the
// time a test body ran, even though the mount itself was verified present
// right after `beforeAll`). Matches soribashi's own contrast-matrix.test.tsx,
// which avoids the main entry for the identical reason — see its own header
// comment.
import { render } from "vitest-browser-react/pure";
import { CONTRAST_DEBT_BY_KEY, contrastDebtKey } from "../../a11y/known-contrast-debt.ts";
import { tuiTheme, tuiVocabulary } from "../../theme.ts";
import { Button, BUTTON_PARTS } from "./Button.tsx";

registerTheme(tuiTheme);

function renderCell(ui: ReactNode, options: { container: HTMLElement }) {
  return render(<SoribashiProvider theme={tuiTheme}>{ui}</SoribashiProvider>, options);
}

const VARIANTS = tuiVocabulary.variant.values;
const INTENTS = tuiVocabulary.intent.values;
const SCHEMES = ["light", "dark"] as const;

/**
 * Rest-state contrast, every variant x intent x scheme cell. NOT
 * `describeColourGrid` (the shared harness): cells with known-contrast-debt
 * ledger entries (known-contrast-debt.ts) are ratcheted rather than exempted —
 * the harness's own floor check has no hook for that per-cell branch, so the
 * grid is assembled here from its lower-level primitives instead.
 *
 * A ledger cell asserts `measuredRatio - 0.05 <= ratio < MIN_CONTRAST`: a
 * regression past the 0.05 measurement-noise tolerance fails (catches a
 * theme change quietly making a known-bad cell worse), and clearing
 * MIN_CONTRAST also fails — forcing that entry's removal from the ledger
 * rather than letting a real fix go unnoticed. A cell absent from the ledger
 * asserts the plain floor; the transparent-background variants (outline/
 * subtle) composite against the live-resolved canvas colour via `contrastRatio`
 * the same way the shared harness does.
 */
describe(`Button contrast matrix (WCAG AA >= ${MIN_CONTRAST}:1, ratcheted against known debt)`, () => {
  let container: HTMLDivElement;
  let removeNoTransitionStyle: () => void;

  beforeAll(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    removeNoTransitionStyle = installNoTransitionStyle();
    container.classList.add(NO_TRANSITION_CLASS);

    await renderCell(
      <>
        {INTENTS.map((intent) =>
          VARIANTS.map((variant) => (
            <Fragment key={cellId("Button", intent, variant)}>
              <Button
                intent={intent}
                variant={variant}
                attributes={{ root: { "data-testid": cellId("Button", intent, variant) } }}
              >
                {intent}
              </Button>
            </Fragment>
          )),
        )}
      </>,
      { container },
    );
  });

  afterAll(() => {
    container.remove();
    removeNoTransitionStyle();
  });

  function assertCell(intent: string, variant: string, scheme: (typeof SCHEMES)[number]) {
    const id = cellId("Button", intent, variant);
    const el = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`Button contrast matrix: no element rendered for combination "${id}"`);

    const cs = getComputedStyle(el);
    const fg = toRgbString(cs.color);
    const bg = toRgbString(cs.backgroundColor);
    const backdrop = resolveCanvasColor(container);
    const ratio = contrastRatio(fg, bg, backdrop);
    const label = `${scheme}/${variant}/${intent}: fg=${fg} bg=${bg} backdrop=${backdrop} ratio=${ratio.toFixed(3)}`;

    const debt = CONTRAST_DEBT_BY_KEY.get(contrastDebtKey({ variant, intent, scheme, state: "rest" }));
    if (debt) {
      expect(
        ratio,
        `${label} — regressed below its known-contrast-debt.ts floor (${debt.measuredRatio} - 0.05 tolerance)`,
      ).toBeGreaterThanOrEqual(debt.measuredRatio - 0.05);
      expect(
        ratio,
        `${label} — cleared MIN_CONTRAST; remove this cell's entry from known-contrast-debt.ts`,
      ).toBeLessThan(MIN_CONTRAST);
    } else {
      expect(ratio, label).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  }

  describe("light scheme", () => {
    test.each(INTENTS)("intent=%s (every variant) clears AA or matches its ledger entry", (intent) => {
      for (const variant of VARIANTS) assertCell(intent, variant, "light");
    });
  });

  describe("dark scheme", () => {
    beforeAll(() => {
      container.classList.add("dark");
      void container.offsetHeight;
    });

    afterAll(() => {
      container.classList.remove("dark");
    });

    test.each(INTENTS)("intent=%s (every variant) clears AA or matches its ledger entry", (intent) => {
      for (const variant of VARIANTS) assertCell(intent, variant, "dark");
    });
  });
});

/**
 * Hover-delta: every one of tui-kit's four variants defines a `hover`
 * background in singleShadeVariantColors' single-shade branch (intent-resolver.ts),
 * so a real pointer hover must visibly change the rendered background —
 * proving the hover treatment actually reaches the DOM, not just the resolver
 * output. This is deliberately NOT a second contrast-floor check: the floor
 * (or ledger ratchet) is a rest-state property, checked by the grid above,
 * and re-asserting it here would just duplicate that grid under a slower
 * real-pointer path for no new coverage.
 */
const NO_MOTION_CLASS = "button-matrix-no-motion";
function installNoMotionStyle() {
  if (document.getElementById(NO_MOTION_CLASS)) return;
  const style = document.createElement("style");
  style.id = NO_MOTION_CLASS;
  style.textContent = `.${NO_MOTION_CLASS}, .${NO_MOTION_CLASS} * {
    animation: none !important;
    transition: none !important;
  }`;
  document.head.appendChild(style);
}

function buttonOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${BUTTON_PARTS.root}"]`);
  if (!el) throw new Error("no Button rendered");
  return el;
}

describe("Button hover-delta (every variant's hover fill actually changes the rendered background)", () => {
  it.each(
    SCHEMES.flatMap((scheme) =>
      VARIANTS.flatMap((variant) => INTENTS.map((intent) => [scheme, variant, intent] as const)),
    ),
  )("%s scheme, variant=%s, intent=%s: hover changes background-color", async (scheme, variant, intent) => {
    await page.viewport(900, 500);
    installNoMotionStyle();
    const removeNoTransitionStyle = installNoTransitionStyle();

    // A fresh container's button often lands at the same screen coordinate a
    // PRIOR case's real pointer hover left the cursor at — parking it
    // off-canvas first stops that from contaminating this case's rest read.
    const park =
      document.querySelector<HTMLElement>('[data-testid="button-matrix-park"]') ??
      (() => {
        const el = document.createElement("div");
        el.setAttribute("data-testid", "button-matrix-park");
        Object.assign(el.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px" });
        document.body.appendChild(el);
        return el;
      })();
    await page.getByTestId("button-matrix-park").hover();
    void park;

    const container = document.createElement("div");
    container.classList.add(NO_MOTION_CLASS, NO_TRANSITION_CLASS);
    if (scheme === "dark") container.classList.add("dark");
    document.body.appendChild(container);

    const label = `${variant} ${intent} ${scheme}`;
    const screen = await renderCell(
      <Button intent={intent} variant={variant}>
        {label}
      </Button>,
      { container },
    );

    const button = buttonOf(screen.container);
    const restBg = getComputedStyle(button).backgroundColor;

    await screen.getByRole("button", { name: label }).hover();
    const hoverBg = getComputedStyle(button).backgroundColor;

    expect(
      hoverBg,
      `${label}: hover background (${hoverBg}) did not change from rest (${restBg})`,
    ).not.toBe(restBg);

    await screen.unmount();
    container.remove();
    removeNoTransitionStyle();
  });
});
