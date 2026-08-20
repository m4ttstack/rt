import { createTheme } from "@soribashi/core";
import { describe, expect, it } from "vitest";
import { renderWithTheme } from "../../../test/test-utils.tsx";
import { tuiTheme } from "../../theme.ts";
import { Chip, CHIP_PARTS } from "./Chip.tsx";

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
// mr-board's badge/flag family (src/client/board/chips.tsx plus the
// `.tui-review*` / `.tui-flag` / `.tui-respond*` / `.tui-doctor*` / `.tui-peer*`
// / `.tui-nudge*` / `.tui-held-draft*` / `.tui-draft` CSS families, located by
// class name), expressed as Chip props. Task 20 (adoption) consumes it: each
// row names the board component and class it replaces.
//
// `alias` is the board's OWN colour variable the cell must resolve to, so the
// row proves the intent resolver landed on mr-board's palette rather than on
// soribashi's default ramp.
//
// KNOWN, DELIBERATE DRIFT, recorded once here rather than per row: mr-board's
// review/respond/doctor terminal states paint `--dot-ok` / `--dot-warn` /
// `--dot-bad` (the brighter status-dot trio), NOT `--green` / `--amber` /
// `--red`. tuiIntentResolver maps ok/warn/bad onto the HUE families, so those
// cells shift by one shade. Every other colour in the family (`--accent`,
// `--purple`, `--cyan`, `--amber` on held-draft, `--muted`, and all four
// `.tui-flag` `t-*` classes) maps byte-exact. See Chip.tsx's own note.
// ---------------------------------------------------------------------------

interface CensusRow {
  /** The mr-board component + CSS class this cell replaces. */
  board: string;
  /** The theme alias the cell's text colour must resolve to. */
  alias: string;
  /** Props the adoption site passes. */
  props: Record<string, unknown>;
}

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
    props: { intent: "warn", pulse: true },
  },
  {
    board: "ReviewBadge done (.tui-review-done)",
    alias: "--green",
    props: { intent: "ok" },
  },
  {
    board: "ReviewBadge error (.tui-review-error)",
    alias: "--red",
    props: { intent: "bad" },
  },
  {
    board: "ReviewBadge report-ready (.tui-review-open)",
    alias: "--green",
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
    props: { intent: "ok" },
  },
  {
    board: "RespondBadge partial/drafted (.tui-respond-drafted)",
    alias: "--amber",
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
    props: { intent: "bad" },
  },
  {
    board: "RespondBadge needs-attention resume (.tui-respond-* + .tui-review-open)",
    alias: "--amber",
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
    props: { intent: "ok" },
  },
  {
    board: "DoctorBadge error (.tui-doctor-error)",
    alias: "--red",
    props: { intent: "bad" },
  },

  // ── PeerBadge (.tui-peer-*) ──────────────────────────────────────────────
  {
    board: "PeerBadge base / requested (.tui-peer)",
    alias: "--accent",
    props: { intent: "accent" },
  },
  {
    board: "PeerBadge reviewing (.tui-peer-reviewing)",
    alias: "--accent",
    props: { intent: "accent", pulse: true },
  },
  {
    board: "PeerBadge commented (.tui-peer-commented)",
    alias: "--amber",
    props: { intent: "warn" },
  },
  {
    board: "PeerBadge approved (.tui-peer-approved)",
    alias: "--green",
    props: { intent: "ok" },
  },
  {
    board: "PeerBadge done (.tui-peer-done)",
    alias: "--muted",
    props: { intent: "muted" },
  },

  // ── NudgeChip (.tui-nudge-*) ─────────────────────────────────────────────
  {
    board: "NudgeChip requested (.tui-nudge-requested)",
    alias: "--accent",
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
    props: { intent: "warn", dimmed: true },
  },

  // ── StatusFlags (.tui-flag + t-*) ────────────────────────────────────────
  {
    board: "StatusFlags conflict (.tui-flag.t-bad)",
    alias: "--red",
    props: { intent: "bad" },
  },
  {
    board: "StatusFlags ci-warning (.tui-flag.t-warn)",
    alias: "--amber",
    props: { intent: "warn" },
  },
  {
    board: "StatusFlags ok (.tui-flag.t-ok)",
    alias: "--green",
    props: { intent: "ok" },
  },
  {
    board: "StatusFlags quiet (.tui-flag.t-muted)",
    alias: "--muted",
    props: { intent: "muted" },
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
  it.each(CENSUS.map((row) => [row.board, row] as const))(
    "%s",
    async (_label, row) => {
      const { chip, aliasColor, fgColor, borderColor } = await renderWithProbe(
        <Chip {...row.props}>label</Chip>,
        row.alias,
      );

      // 1. The intent resolver landed on mr-board's own palette value.
      expect(getComputedStyle(chip).color).toBe(aliasColor);
      if (row.alias !== "--fg") expect(getComputedStyle(chip).color).not.toBe(fgColor);

      // 2. The border follows the variant: `outline` (the default) takes the
      //    intent colour, `subtle` keeps the board's neutral `--border` frame.
      const variant = (row.props.variant as string | undefined) ?? "outline";
      expect(chip.getAttribute("data-variant")).toBe(variant);
      expect(getComputedStyle(chip).borderTopColor).toBe(
        variant === "outline" ? aliasColor : borderColor,
      );
      expect(getComputedStyle(chip).borderTopWidth).toBe("1px");

      // 3. The axis attribute app-side CSS can select on.
      expect(chip.getAttribute("data-intent")).toBe(row.props.intent);

      // 4. The boolean modifiers, each observed as its rendered consequence.
      const pulse = row.props.pulse === true;
      expect(getComputedStyle(chip).animationName === "none").toBe(!pulse);

      const dimmed = row.props.dimmed === true;
      expect(getComputedStyle(chip).opacity === "1").toBe(!dimmed);

      const uppercase = row.props.uppercase === true;
      expect(getComputedStyle(chip).textTransform).toBe(uppercase ? "uppercase" : "none");

      // 5. The element the cell renders as.
      expect(chip.tagName.toLowerCase()).toBe((row.props.as as string | undefined) ?? "span");
    },
  );
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

  it("pulses on the board's cadence, and only when asked", async () => {
    const still = await renderWithTheme(<Chip>done</Chip>);
    expect(getComputedStyle(chipOf(still.container)).animationName).toBe("none");

    const pulsing = await renderWithTheme(<Chip pulse>reviewing</Chip>);
    const style = getComputedStyle(chipOf(pulsing.container));
    expect(style.animationName).not.toBe("none");
    expect(style.animationIterationCount).toBe("infinite");
    expect(style.animationTimingFunction).toBe("ease-in-out");
    // mr-board: `animation: tui-review-pulse 1.4s ease-in-out infinite` over
    // keyframes 0/50/100. Chip expresses the identical motion as a half-period
    // `alternate`, so the duration reads as half of the 1.4s full cycle.
    expect(style.animationDirection).toBe("alternate");
    expect(style.animationDuration).toBe("0.7s");
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
  it("intent=\"ok\" resolves to the theme's green family, not to nothing", async () => {
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
