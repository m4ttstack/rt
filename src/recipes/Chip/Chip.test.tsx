import { createTheme } from "@soribashi/core";
import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { Chip, CHIP_PARTS, type ChipOwnProps, type ChipProps } from "./Chip.tsx";

/**
 * Browser tier for the Chip recipe.
 *
 * Chip is the first recipe in this kit that DECLARES VOCABULARY AXES, so this
 * file carries two things Icon's could not: the census-driven colour matrix
 * (every intent word, resolved through tuiIntentResolver, observed as a real
 * computed colour) and the provider-dependence canary at the bottom.
 *
 * Conventions inherited from Icon.test.tsx and task 8's checklist:
 *  - every render goes through `renderWithTheme` (test/test-utils.tsx), never
 *    vitest-browser-react's `render` directly — the helper pairs
 *    `registerTheme(tuiTheme)` with a real `<SoribashiProvider>` and BOTH are
 *    silent when missing;
 *  - assertions observe rendered behaviour (computed styles, the accessibility
 *    tree, real interaction), not emitted CSS text (authoring skill § 18). The
 *    one sanctioned structural assertion is `data-part`, because the attribute
 *    IS the cross-boundary contract.
 */

// ---------------------------------------------------------------------------
// THE CENSUS. Written before Chip.tsx existed: this table IS the inventory of
// mr-board's badge/flag family — src/client/board/chips.tsx and RowView.tsx's
// StatusFlags, plus the `.tui-review*` / `.tui-flag` / `.tui-respond*` /
// `.tui-doctor*` / `.tui-peer*` / `.tui-nudge*` / `.tui-held-draft*` /
// `.tui-draft` CSS families, located by class name — expressed as Chip props.
// Tasks 19/20 (adoption) consume it as REQUIREMENTS, so it is inventory, not a
// showcase: every row below is a state mr-board can actually render today.
//
// FIDELITY RULES THIS TABLE IS HELD TO, after the task-9 review:
//  - A row exists only if the board's own code can produce it. Three rows were
//    deleted for failing that: `.tui-flag.t-ok` and `.tui-flag.t-muted` (which
//    statusFlags() in mr-board's src/view.ts never emits — it emits only
//    `t-bad`, `t-warn` and `t-cyan`; `t-ok`/`t-muted` live on `.tui-phrase`, a
//    different component), and a plain non-pulsing `.tui-peer` (peerState() in
//    format.ts returns only reviewing|commented|approved|done, and `reviewing`
//    always pulses, so accent-without-pulse never reaches the DOM). The
//    stacked-MR flag `.tui-flag.t-cyan` was ADDED for the same reason: it ships
//    and it was missing.
//  - `dotColour` is PER ROW, never per file. See its own comment below.
//  - `outlier` is per row too, for any cell where the chip's canonical
//    treatment is not the board's own value.
//  - `props` is a TYPED prop union, not `Record<string, unknown>`: a typo like
//    `{ dimed: true }` must be a compile error, because the modifier
//    assertions below read the row's own props and would otherwise pass
//    vacuously against a prop that never reached the component.
// ---------------------------------------------------------------------------

/**
 * Exactly what a census row may pass. `intent` and `variant` are pulled off
 * `ChipProps` rather than restated, so a change to the theme's vocabulary or to
 * CHIP_VARIANTS breaks this table instead of silently widening it.
 *
 * `as` cannot come from `ChipProps`: `ComponentProps<typeof Chip>` resolves the
 * polymorphic signature at its DEFAULT element, so `ChipProps['as']` is
 * `'span'` alone. The three elements the census actually uses are listed here.
 */
type CensusProps = Pick<ChipOwnProps, "pulse" | "dimmed" | "uppercase"> & {
  intent?: NonNullable<ChipProps["intent"]>;
  variant?: NonNullable<ChipProps["variant"]>;
  as?: "span" | "button" | "a";
  /** The universal style prop `.tui-nudged`'s font-weight rides. */
  fw?: number;
};

interface CensusRow {
  /** The mr-board component + CSS class this cell replaces. */
  board: string;
  /** The theme alias the cell's text colour must resolve to. */
  alias: string;
  /**
   * PER-ROW RULING R10 MARKING. Set when mr-board paints this cell from the
   * brighter STATUS-DOT trio — `--dot-ok` #1f9d3a, `--dot-warn` #e08a00,
   * `--dot-bad` #e5153f — while `tuiIntentResolver` maps ok/warn/bad onto the
   * HUE families (`--green` #587539, `--amber` #8c6c3e, `--red` #f52a65). Such
   * a cell shifts by one shade at adoption.
   *
   * Deliberate, and it stays board-side per ruling R10: the `--dot-*` trio
   * belongs to StatusDot (task 11) and the resolver is shared. A consumer who
   * wants exact parity writes one `Chip.extend({ vars })` entry or one
   * app-side `[data-part="chip"][data-intent="ok"]` rule.
   *
   * It is a per-ROW field rather than a note at the top of the file because it
   * is NOT confined to terminal states: `.tui-review-reviewing` (in flight, and
   * pulsing), `.tui-respond-partial`/`-drafted`, `.tui-peer-commented` and
   * `.tui-peer-approved` are all dot-coloured too. A task-19/20 reader working
   * row by row has to see it on the row.
   */
  dotColour?: "--dot-ok" | "--dot-warn" | "--dot-bad";
  /** Set when the chip's canonical treatment is not the board's own value. */
  outlier?: string;
  /** Props the adoption site passes. */
  props: CensusProps;
}

/** The board's standing dim on every mechanical-blocker flag. */
const FLAG_DIM =
  "`.tui-flag` carries a standing `opacity: 0.9` that Chip does not reproduce: " +
  "`dimmed` is one canonical 0.7, so a flag either reads at full strength (as " +
  "here) or drops to 0.7. The 0.9 comes back as an app-side rule if it is missed.";

const CENSUS: CensusRow[] = [
  // ── ReviewBadge (.tui-review-*) ──────────────────────────────────────────
  {
    board: "ReviewBadge queued (.tui-review-queued)",
    alias: "--muted",
    props: { intent: "muted", variant: "subtle", dimmed: true },
  },
  {
    board: "ReviewBadge reviewing (.tui-review-reviewing)",
    alias: "--amber",
    dotColour: "--dot-warn",
    props: { intent: "warn", pulse: true },
  },
  {
    board: "ReviewBadge done (.tui-review-done)",
    alias: "--green",
    dotColour: "--dot-ok",
    props: { intent: "ok" },
  },
  {
    board: "ReviewBadge error (.tui-review-error)",
    alias: "--red",
    dotColour: "--dot-bad",
    props: { intent: "bad" },
  },
  {
    board: "ReviewBadge report-ready (.tui-review-done + .tui-review-open)",
    alias: "--green",
    dotColour: "--dot-ok",
    props: { intent: "ok", as: "button" },
  },

  // ── RespondBadge (.tui-respond-*) ────────────────────────────────────────
  {
    board: "RespondBadge queued (.tui-respond-queued)",
    alias: "--muted",
    props: { intent: "muted", variant: "subtle", dimmed: true },
  },
  {
    board: "RespondBadge triaging/implementing/drafting (.tui-respond-drafting)",
    alias: "--purple",
    props: { intent: "purple", pulse: true },
  },
  {
    board: "RespondBadge posted/none (.tui-respond-posted)",
    alias: "--green",
    dotColour: "--dot-ok",
    props: { intent: "ok" },
  },
  {
    board: "RespondBadge partial/drafted (.tui-respond-drafted)",
    alias: "--amber",
    dotColour: "--dot-warn",
    props: { intent: "warn" },
  },
  {
    board: "RespondBadge unknown (.tui-respond-unknown)",
    alias: "--muted",
    props: { intent: "muted" },
  },
  {
    board: "RespondBadge error (.tui-respond-error)",
    alias: "--red",
    dotColour: "--dot-bad",
    props: { intent: "bad" },
  },
  {
    // respondNeedsAttention() is `partial || drafted` (mr-board
    // src/respond-outcome.ts), so the resumable button form is only ever the
    // warn-family cell — never posted/none/unknown.
    board: "RespondBadge needs-attention resume (.tui-respond-drafted + .tui-review-open)",
    alias: "--amber",
    dotColour: "--dot-warn",
    props: { intent: "warn", as: "button" },
  },

  // ── DoctorBadge (.tui-doctor-*) ──────────────────────────────────────────
  {
    board: "DoctorBadge queued (.tui-doctor-queued)",
    alias: "--muted",
    props: { intent: "muted", variant: "subtle", dimmed: true },
  },
  {
    board: "DoctorBadge diagnosing/rebasing/fixing/watching (.tui-doctor-fixing)",
    alias: "--cyan",
    props: { intent: "cyan", pulse: true },
  },
  {
    board: "DoctorBadge done (.tui-doctor-done)",
    alias: "--green",
    dotColour: "--dot-ok",
    props: { intent: "ok" },
  },
  {
    board: "DoctorBadge error (.tui-doctor-error)",
    alias: "--red",
    dotColour: "--dot-bad",
    props: { intent: "bad" },
  },

  // ── PeerBadge (.tui-peer-*) ──────────────────────────────────────────────
  // peerState() (mr-board src/client/board/format.ts) returns exactly
  // reviewing | commented | approved | done | null, so those four are the whole
  // inventory. `.tui-peer`'s bare accent never renders on its own: the only
  // state that keeps it (`reviewing`, which also covers `queued`) pulses.
  {
    board: "PeerBadge queued/reviewing (.tui-peer + .tui-peer-reviewing)",
    alias: "--accent",
    props: { intent: "accent", pulse: true },
  },
  {
    board: "PeerBadge commented (.tui-peer-commented)",
    alias: "--amber",
    dotColour: "--dot-warn",
    props: { intent: "warn" },
  },
  {
    board: "PeerBadge approved (.tui-peer-approved)",
    alias: "--green",
    dotColour: "--dot-ok",
    props: { intent: "ok" },
  },
  {
    board: 'PeerBadge done, reads "reviewed" (.tui-peer-done)',
    alias: "--muted",
    props: { intent: "muted" },
  },

  // ── NudgeChip (.tui-nudge-*) ─────────────────────────────────────────────
  {
    board: "NudgeChip requested (.tui-nudge-requested)",
    alias: "--accent",
    outlier:
      "the board dims this one to 0.75, not 0.7. Flattened onto `dimmed`'s " +
      "single canonical value; 0.05 of opacity is not worth a second prop.",
    props: { intent: "accent", dimmed: true },
  },
  {
    board: "NudgeChip confirmed/launched (.tui-nudge-launched)",
    alias: "--accent",
    props: { intent: "accent", pulse: true },
  },
  {
    board: "NudgeChip rejected/expired/no-response (.tui-nudge-expired)",
    alias: "--muted",
    props: { intent: "muted" },
  },

  // ── NudgedByMarker (.tui-nudged) ─────────────────────────────────────────
  // `fw` is a UNIVERSAL STYLE PROP the builder supplies free (skill § 5), so
  // `.tui-nudged { font-weight: 600 }` needs no recipe API of its own.
  {
    board: "NudgedByMarker (.tui-nudged)",
    alias: "--accent",
    props: { intent: "accent", fw: 600 },
  },

  // ── DraftBadge (.tui-held-draft*) ────────────────────────────────────────
  {
    board: "DraftBadge held (.tui-held-draft + .tui-review-open)",
    alias: "--amber",
    props: { intent: "warn", as: "button" },
  },
  {
    board: "DraftBadge resolved (.tui-held-draft-resolved)",
    alias: "--amber",
    outlier:
      "the board dims this one to 0.6, not 0.7 — the deepest of its four " +
      "quiet values. Flattened onto `dimmed`; an app-side rule restores it.",
    props: { intent: "warn", dimmed: true },
  },

  // ── StatusFlags (.tui-flag + t-*) ────────────────────────────────────────
  // statusFlags() (mr-board src/view.ts) emits EXACTLY three classes:
  // `t-bad` (conflicts, ci failing), `t-warn` (ci running), `t-cyan` (stacked
  // under a parent branch). There is no `t-ok` and no `t-muted` flag; those two
  // classes belong to `.tui-phrase`, a different component and not this
  // recipe's job.
  {
    board: "StatusFlags conflicts / ci failing (.tui-flag.t-bad)",
    alias: "--red",
    outlier: FLAG_DIM,
    props: { intent: "bad" },
  },
  {
    board: "StatusFlags ci running (.tui-flag.t-warn)",
    alias: "--amber",
    outlier: FLAG_DIM,
    props: { intent: "warn" },
  },
  {
    board: "StatusFlags stacked → parent (.tui-flag.t-cyan)",
    alias: "--cyan",
    outlier: FLAG_DIM,
    props: { intent: "cyan" },
  },

  // ── draft marker (.tui-draft) ────────────────────────────────────────────
  {
    board: "draft marker (.tui-draft)",
    alias: "--muted",
    props: { intent: "muted", variant: "subtle", uppercase: true },
  },
];

/** The chip root, found by the attribute app-side CSS actually selects on. */
function chipOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-part="${CHIP_PARTS.root}"]`);
  if (!el) throw new Error("no chip rendered");
  return el;
}

/**
 * Renders `ui` next to a probe span painted with `var(<alias>)`, so a colour
 * assertion compares two REAL computed values rather than an expected string.
 * The wrapper's own colour is deliberately `--fg`, which no census row uses:
 * a chip whose `--chip-color` failed to resolve would fall back to inherit and
 * read as `--fg`, which is what `notToBe(fgColor)` catches.
 */
async function renderWithProbe(ui: React.ReactNode, alias: string) {
  const screen = await renderWithTheme(
    <div style={{ color: "var(--fg)" }}>
      {ui}
      <span data-testid="probe" style={{ color: `var(${alias})` }} />
      <span data-testid="fg-probe" style={{ color: "var(--fg)" }} />
      <span data-testid="border-probe" style={{ color: "var(--border)" }} />
    </div>,
  );
  const probeColor = (testid: string) =>
    getComputedStyle(
      screen.container.querySelector(`[data-testid="${testid}"]`) as HTMLElement,
    ).color;
  return {
    screen,
    chip: chipOf(screen.container),
    aliasColor: probeColor("probe"),
    fgColor: probeColor("fg-probe"),
    borderColor: probeColor("border-probe"),
  };
}

describe("Chip (browser) — the mr-board badge/flag census", () => {
  it.each(CENSUS.map((row) => [row.board, row] as const))("%s", async (_label, row) => {
    const { chip, aliasColor, fgColor, borderColor } = await renderWithProbe(
      // The census's `as` is a union of three elements, which a polymorphic
      // call site cannot express in one spread (each `as` value narrows the
      // rest of the prop surface to a different element). The TABLE is what
      // needed the types — a mistyped modifier key must not compile — and it
      // has them; only this spread is cast.
      <Chip {...(row.props as ChipProps)}>label</Chip>,
      row.alias,
    );

    // 1. The intent resolver landed on mr-board's own palette value.
    expect(getComputedStyle(chip).color).toBe(aliasColor);
    expect(getComputedStyle(chip).color).not.toBe(fgColor);

    // 2. The border follows the variant: `outline` (the default) takes the
    //    intent colour, `subtle` keeps the board's neutral `--border` frame.
    const variant = row.props.variant ?? "outline";
    expect(chip.getAttribute("data-variant")).toBe(variant);
    expect(getComputedStyle(chip).borderTopColor).toBe(
      variant === "outline" ? aliasColor : borderColor,
    );
    expect(getComputedStyle(chip).borderTopWidth).toBe("1px");

    // 3. The axis attribute app-side CSS can select on.
    expect(chip.getAttribute("data-intent")).toBe(row.props.intent);

    // 4. The boolean modifiers, each observed as its rendered consequence.
    //    `row.props` is TYPED, so a misspelt key here is a compile error rather
    //    than a silently-false read that vacuously asserts the default.
    const pulse = row.props.pulse === true;
    expect(getComputedStyle(chip).animationName === "none").toBe(!pulse);

    const dimmed = row.props.dimmed === true;
    expect(getComputedStyle(chip).opacity === "1").toBe(!dimmed);

    const uppercase = row.props.uppercase === true;
    expect(getComputedStyle(chip).textTransform).toBe(uppercase ? "uppercase" : "none");

    // 5. The element the cell renders as.
    expect(chip.tagName.toLowerCase()).toBe(row.props.as ?? "span");
  });

  it("every dotColour marking names the slot its own intent maps to", () => {
    // Gives the R10 marking teeth: without this, `dotColour` is a comment that
    // can drift onto the wrong row, or name the wrong dot, and nothing notices.
    // The forward direction only — `--amber` is byte-exact on `.tui-held-draft`
    // and `.tui-flag.t-warn`, so "the alias is a hue family" does NOT imply a
    // drift, and the converse cannot be asserted mechanically.
    const SLOT: Record<string, string> = {
      ok: "--dot-ok",
      warn: "--dot-warn",
      bad: "--dot-bad",
    };

    for (const row of CENSUS) {
      if (!row.dotColour) continue;
      const intent = row.props.intent;
      expect(intent, `${row.board}: dotColour set on a row with no intent`).toBeDefined();
      expect(SLOT[intent as string], `${row.board}: intent "${intent}" has no dot slot`).toBe(
        row.dotColour,
      );
    }

    // The drift is real and widespread, not a footnote: if this count collapses
    // someone has quietly dropped the markings rather than fixed the palette.
    expect(CENSUS.filter((r) => r.dotColour).length).toBe(12);
  });
});

describe("Chip (browser)", () => {
  it("renders its children inside the board's chip shape", async () => {
    const screen = await renderWithTheme(<Chip>needs review</Chip>);
    const chip = chipOf(screen.container);

    expect(chip.textContent).toBe("needs review");
    // Every declaration below differs from a bare <span>'s browser default, so
    // together they prove Chip.module.css reached the DOM inside
    // @layer soribashi.recipes — not just that a class name was emitted.
    const style = getComputedStyle(chip);
    expect(style.display).toBe("inline-flex");
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.flexShrink).toBe("0");
    expect(style.borderTopStyle).toBe("solid");
    // tuiTheme: --radius-sm 4px, --font-size-px11 11px, --spacing-px6 6px.
    expect(style.borderTopLeftRadius).toBe("4px");
    expect(style.fontSize).toBe("11px");
    expect(style.paddingLeft).toBe("6px");
    expect(style.paddingTop).toBe("1px");
  });

  it("stamps its two data-parts (the kit's cross-boundary hook)", async () => {
    const screen = await renderWithTheme(<Chip icon={<span>x</span>}>done</Chip>);

    expect(screen.container.querySelectorAll('[data-part="chip"]')).toHaveLength(1);
    expect(screen.container.querySelectorAll('[data-part="chip-icon"]')).toHaveLength(1);
    expect(CHIP_PARTS).toEqual({ root: "chip", icon: "chip-icon" });
  });

  it("a consumer-supplied data-part does not win", async () => {
    // data-part is a CONTRACT between the kit and mr-board's stylesheet, not a
    // consumer-facing prop: it is stamped in the non-overridable tail, AFTER
    // {...rest}. Reordering the stamp in front of {...rest} fails this case.
    const screen = await renderWithTheme(<Chip data-part="hijacked">done</Chip>);

    expect(chipOf(screen.container).getAttribute("data-part")).toBe("chip");
    expect(screen.container.querySelectorAll('[data-part="hijacked"]')).toHaveLength(0);
  });

  it("omits the icon slot entirely when no icon is passed", async () => {
    const screen = await renderWithTheme(<Chip>done</Chip>);

    expect(screen.container.querySelectorAll('[data-part="chip-icon"]')).toHaveLength(0);
  });

  it("never hand-emits an axis it did not opt into", async () => {
    // getStyles('root') owns data-variant/data-intent/data-size and emits each
    // only for a declared axis. Chip opts into intent + variant, NOT size.
    const screen = await renderWithTheme(<Chip intent="cyan">done</Chip>);
    const chip = chipOf(screen.container);

    expect(chip.getAttribute("data-intent")).toBe("cyan");
    expect(chip.getAttribute("data-variant")).toBe("outline");
    expect(chip.getAttribute("data-size")).toBeNull();
  });

  it("does not leak the vocabulary-axis props onto the DOM as raw attributes", async () => {
    // The builder does NOT strip size/intent/variant before render (skill § 7),
    // so a recipe that forgot to destructure them would emit intent="cyan" and
    // variant="outline" as literal attributes alongside the data-* pair.
    const screen = await renderWithTheme(
      <Chip intent="cyan" variant="subtle">
        done
      </Chip>,
    );
    const chip = chipOf(screen.container);

    expect(chip.getAttribute("intent")).toBeNull();
    expect(chip.getAttribute("variant")).toBeNull();
    expect(chip.getAttribute("classNames")).toBeNull();
    expect(chip.getAttribute("unstyled")).toBeNull();
  });

  it("runs under no-preference reduced motion, so the pulse cases mean something", () => {
    // The pulse assertions in this file read `animationName`, which
    // Chip.module.css sets to `none` under
    // `@media (prefers-reduced-motion: reduce)`. That media query is an
    // ENVIRONMENT input: on a machine (or a browser launch) carrying the
    // preference, five census rows plus the cadence case below would go red for
    // a reason that has nothing to do with the recipe.
    //
    // vitest.browser.config.ts pins the playwright context to
    // `reducedMotion: "no-preference"` so the tier is deterministic. This case
    // is that pin's canary: if the option is dropped, renamed, or stops being
    // honoured, this fails FIRST and names the cause, instead of six colour and
    // cadence assertions failing with a confusing "expected true to be false".
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
  });

  it("pulses on the board's cadence, and only when asked", async () => {
    const still = await renderWithTheme(<Chip>done</Chip>);
    expect(getComputedStyle(chipOf(still.container)).animationName).toBe("none");

    const pulsing = await renderWithTheme(<Chip pulse>reviewing</Chip>);
    const style = getComputedStyle(chipOf(pulsing.container));
    expect(style.animationName).not.toBe("none");
    expect(style.animationIterationCount).toBe("infinite");
    expect(style.animationTimingFunction).toBe("ease-in-out");
    // mr-board: `animation: tui-review-pulse 1.4s ease-in-out infinite` over
    // keyframes 0/50/100. Chip now expresses that verbatim (SORI-18 fixed the
    // CSS gate to treat a keyframe-selector percentage as selector syntax, not
    // a flagged length value, so the natural spelling no longer needs the
    // half-period `alternate` workaround).
    expect(style.animationDirection).toBe("normal");
    expect(style.animationDuration).toBe("1.4s");
  });

  it("renders as a real button when asked, and is reachable by role", async () => {
    // `as="button"` — the builder's own polymorphism — is the clickable-badge
    // case (.tui-review-open). The icon slot is decorative, so the button's
    // accessible name is its children alone.
    const screen = await renderWithTheme(
      <Chip as="button" icon={<span>*</span>}>
        review ready
      </Chip>,
    );

    const button = screen.getByRole("button", { name: "review ready" });
    await expect.element(button).toBeVisible();

    const chip = chipOf(screen.container);
    expect(chip.tagName.toLowerCase()).toBe("button");
    // Never a submit button: a chip inside a form must not post it.
    expect(chip.getAttribute("type")).toBe("button");
    expect(getComputedStyle(chip).cursor).toBe("pointer");
    // The UA button font is reset back to the board's inherited monospace.
    expect(getComputedStyle(chip).fontFamily).toBe(
      getComputedStyle(chip.parentElement as HTMLElement).fontFamily,
    );
  });

  it("fires its onClick as a button", async () => {
    let clicks = 0;
    const screen = await renderWithTheme(
      <Chip as="button" onClick={() => clicks++}>
        open
      </Chip>,
    );

    await screen.getByRole("button", { name: "open" }).click();
    expect(clicks).toBe(1);
  });

  it("stays a plain span by default, exposing no spurious interactive role", async () => {
    const screen = await renderWithTheme(<Chip>queued</Chip>);

    expect(chipOf(screen.container).tagName.toLowerCase()).toBe("span");
    expect(screen.container.querySelectorAll("button")).toHaveLength(0);
    expect(getComputedStyle(chipOf(screen.container)).cursor).not.toBe("pointer");
  });

  it("accepts universal style props with zero recipe wiring", async () => {
    const screen = await renderWithTheme(
      <Chip m="md" fw={600}>
        nudged
      </Chip>,
    );
    const style = getComputedStyle(chipOf(screen.container));

    // tuiTheme's --spacing-md is 0.6rem, i.e. 9.6px at a 16px root.
    expect(style.marginTop).toBe("9.6px");
    // `.tui-nudged { font-weight: 600 }` rides this, not a recipe prop.
    expect(style.fontWeight).toBe("600");
  });

  it("an app-side rule overrides a modifier by property, never by variable", async () => {
    // THE ESCAPE HATCH TASKS 19/20 WILL ACTUALLY USE, pinned so the
    // stylesheet's comment about it cannot be wrong.
    //
    // The recipe's own scalars (--sb-chip-dimmed-opacity and friends) are
    // emitted by the `vars` resolver, which lands them in the root's INLINE
    // style. An app-side rule setting the VARIABLE therefore loses — inline
    // declarations beat every stylesheet rule. Setting the PROPERTY wins
    // instead, and wins regardless of specificity, because an unlayered author
    // rule beats anything inside `@layer soribashi.recipes`. That is how the
    // three dim outliers (0.75 / 0.6 / 0.9) come back board-side.
    // The two routes are applied to DIFFERENT scopes on purpose: applied to the
    // same chip, `opacity: 0.6` would win whether or not the variable route did
    // anything, and the case would prove only half of what it claims.
    const appRule = document.createElement("style");
    appRule.textContent = `
      .app-var [data-part="chip"][data-dimmed] { --sb-chip-dimmed-opacity: 0.2; }
      .app-prop [data-part="chip"][data-dimmed] { opacity: 0.6; }
    `;
    document.head.appendChild(appRule);
    try {
      const screen = await renderWithTheme(
        <div>
          <span className="app-var" data-testid="via-var">
            <Chip dimmed>resolved</Chip>
          </span>
          <span className="app-prop" data-testid="via-prop">
            <Chip dimmed>resolved</Chip>
          </span>
        </div>,
      );
      const chipIn = (testid: string) =>
        chipOf(screen.container.querySelector(`[data-testid="${testid}"]`) as HTMLElement);

      // 0.7, the recipe's own default: the app's variable was never read,
      // because the inline declaration from the vars resolver shadows it.
      expect(getComputedStyle(chipIn("via-var")).opacity).toBe("0.7");
      // 0.6: setting the property directly wins, unlayered over the recipe.
      expect(getComputedStyle(chipIn("via-prop")).opacity).toBe("0.6");
    } finally {
      appRule.remove();
    }
  });

  it("extend threads defaultProps (invariant 1 stays load-bearing)", async () => {
    // Asserted as a RENDERED CONSEQUENCE: the theme entry's intent has to reach
    // the intent resolver and come back out as a real computed colour.
    const extended = createTheme({
      extends: tuiTheme,
      components: [Chip.extend({ defaultProps: { intent: "purple" } })],
    });

    const screen = await renderWithTheme(
      <div>
        <Chip>respond</Chip>
        <span data-testid="probe" style={{ color: "var(--purple)" }} />
      </div>,
      undefined,
      extended,
    );

    const purple = getComputedStyle(
      screen.container.querySelector('[data-testid="probe"]') as HTMLElement,
    ).color;
    expect(getComputedStyle(chipOf(screen.container)).color).toBe(purple);
    expect(chipOf(screen.container).getAttribute("data-intent")).toBe("purple");
  });

  it("extend threads a defaultProps element too (as resolves after useProps)", async () => {
    // KNOWN SORIBASHI TYPE GAP, not a silenced bug. The builder supports this
    // deliberately at runtime — define-polymorphic-component.tsx says "`as`
    // resolves AFTER useProps (Mantine semantics) so theme defaultProps can
    // retarget the element" — but `PolymorphicExtendProps` (the type
    // `.extend({ defaultProps })` validates against) omits `as` entirely, so
    // the supported call does not type-check:
    //   TS2353: 'as' does not exist in type 'Partial<PolymorphicExtendProps<…>>'
    // The cast is the workaround; this case is what proves the runtime half
    // works, so the gap stays a types-only one. Filed as a friction.
    const extended = createTheme({
      extends: tuiTheme,
      components: [
        Chip.extend({ defaultProps: { as: "button" } } as unknown as Parameters<
          typeof Chip.extend
        >[0]),
      ],
    });

    const screen = await renderWithTheme(<Chip>held</Chip>, undefined, extended);

    expect(chipOf(screen.container).tagName.toLowerCase()).toBe("button");
  });
});

// ---------------------------------------------------------------------------
// Step 3 of the brief: the provider-dependence canary.
// ---------------------------------------------------------------------------

describe("Chip (browser) — provider dependence canary", () => {
  it('intent="ok" resolves to the theme\'s green family, not to nothing', async () => {
    /**
     * THIS IS THE CANARY FOR THE MISSING-PROVIDER FAILURE MODE, and it is the
     * reason `renderWithTheme` exists.
     *
     * `--chip-color` is not written by this recipe's CSS: it arrives from
     * autoVars, which calls the RESOLVED THEME's `intentResolver`. With no
     * `<SoribashiProvider>` above the tree, `useTheme()` silently falls back to
     * an EMPTY default theme whose default resolver looks up ramp shades this
     * palette does not have (`--color-ok-500`, `--color-green-600`, ...). The
     * recipe still renders, `--chip-color` is still SET — to a `var()` naming a
     * custom property nobody declared, which is invalid at computed-value time,
     * so `color` falls back to the inherited value and nothing throws anywhere.
     *
     * So the assertion has to be two-sided: the chip's colour must EQUAL the
     * green family's real value AND must DIFFER from what it would inherit.
     */
    const { chip, aliasColor, fgColor } = await renderWithProbe(
      <Chip intent="ok">approved</Chip>,
      "--green",
    );

    const chipColor = getComputedStyle(chip).color;

    // It resolved to a real, painted colour rather than to an unresolved var().
    expect(chipColor).toMatch(/^rgb/);
    // It is tuiTheme's green family value, reached through tuiIntentResolver.
    expect(chipColor).toBe(aliasColor);
    // ...and not the inherited --fg the broken path would have fallen back to.
    expect(chipColor).not.toBe(fgColor);
    // The same value reaches the border, which is the other half of what the
    // resolver returns (`border`, not just `color`).
    expect(getComputedStyle(chip).borderTopColor).toBe(aliasColor);
  });
});
