import { RADIX, type RadixScaleName, type Scale12 } from './radix.ts';

export const HUES = [
  'accent',
  'ok',
  'bad',
  'warn',
  'purple',
  'cyan',
  'gold',
] as const;
export type HueName = (typeof HUES)[number];
export type HueSet = Record<HueName, string>;

export const HUE_SCALE: Record<HueName, RadixScaleName> = {
  accent: 'indigo',
  ok: 'teal',
  bad: 'crimson',
  warn: 'orange',
  purple: 'purple',
  cyan: 'cyan',
  // Radix amber. The role is named gold because `--amber` is already the
  // shipped public alias for the warn fill. Radix also ships an unrelated
  // scale literally called gold, a muted brown; it is not vendored here.
  gold: 'amber',
};

export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type Ramp4 = readonly [string, string, string, string];
export type Ramp3 = readonly [string, string, string];
export type RampIndex4 = 1 | 2 | 3 | 4;
export type RampIndex3 = 1 | 2 | 3;

export type SurfaceRole =
  'card' | 'panel' | 'page' | 'chrome' | 'inset' | 'overlay' | 'raised';
export type TextRole = 'fg' | 'mutedText' | 'mutedOnCard';
export type LineRole =
  'border' | 'soft' | 'control' | 'edgeOnCard' | 'softOnCard';
export interface HueStep {
  fill: Step;
  text: Step;
}

export interface ColorScheme {
  hue: HueSet;
  hueHover: HueSet;
  hueText: HueSet;
  hueTextSmall: HueSet;
  hueOnFill: HueSet;
  hueTextVivid: HueSet;
  hueStep: Record<HueName, HueStep>;
  surfaceRamp: Ramp4;
  textRamp: Ramp4;
  lineRamp: Ramp3;
  surfaceRole: Record<SurfaceRole, RampIndex4>;
  textRole: Record<TextRole, RampIndex4>;
  lineRole: Record<LineRole, RampIndex3>;
  text: {
    fg: string;
    muted: string;
    mutedText: string;
    accentText: string;
    okText: string;
    warnText: string;
    badgeText: string;
    redText: string;
    mutedOnCard: string;
  };
  surface: {
    chrome: string;
    bg: string;
    panel: string;
    card: string;
    inset: string;
    overlay: string;
    raised: string;
  };
  line: {
    border: string;
    soft: string;
    grid: string;
    control: string;
    edgeOnCard: string;
    controlEdgeOnCard: string;
    softOnCard: string;
  };
  wash: string;
}

export interface Tokens {
  light: ColorScheme;
  dark: ColorScheme;
  font: {
    mono: string;
    sans: string;
    baseSize: string;
    lineHeight: string;
  };
}

type Scheme = 'light' | 'dark';

interface SchemeSpec {
  scheme: Scheme;
  surfaceSteps: readonly [string | Step, Step, Step, Step];
  textSteps: readonly [Step, Step, Step, Step];
  lineSteps: readonly [Step, Step, Step];
  surfaceRole: Record<SurfaceRole, RampIndex4>;
  textRole: Record<TextRole, RampIndex4>;
  lineRole: Record<LineRole, RampIndex3>;
  hueStep: Record<HueName, HueStep>;
  grid: string;
  wash: string;
}

const at = (scale: Scale12, step: Step) => scale[step - 1]!;

// Every value is a step into a vendored Radix scale; a literal hex appears
// only for light surface-1 (pure white). invariants.test.ts checks that the
// steps are the ones the spec's rules pick, not just that the hex match.
function buildScheme(spec: SchemeSpec): ColorScheme {
  const slate = RADIX.slate[spec.scheme];
  const surfaceRamp = spec.surfaceSteps.map(s =>
    typeof s === 'string' ? s : at(slate, s)
  ) as unknown as Ramp4;
  const textRamp = spec.textSteps.map(s => at(slate, s)) as unknown as Ramp4;
  const lineRamp = spec.lineSteps.map(s => at(slate, s)) as unknown as Ramp3;
  // Non-null on purpose: tui-kit compiles this file too, under
  // noUncheckedIndexedAccess, and the indices are typed 1..4 / 1..3.
  const s = (i: RampIndex4) => surfaceRamp[i - 1]!;
  const t = (i: RampIndex4) => textRamp[i - 1]!;
  const l = (i: RampIndex3) => lineRamp[i - 1]!;
  const hueValue = (
    pick: (scale: Scale12, step: HueStep, hue: HueName) => string
  ): HueSet =>
    Object.fromEntries(
      HUES.map(h => [
        h,
        pick(RADIX[HUE_SCALE[h]][spec.scheme], spec.hueStep[h], h),
      ])
    ) as HueSet;
  const hue = hueValue((scale, step) => at(scale, step.fill));
  // Step 10 is the last non-text step, so a fill already on it hovers as the
  // mix tui-kit shipped for filled hover rather than stepping onto text.
  const hueHover = hueValue((scale, step) =>
    step.fill === 9
      ? at(scale, 10)
      : `color-mix(in srgb, ${at(scale, step.fill)} 88%, ${textRamp[0]})`
  );
  // Step 11 is the DEFAULT hue text and step 12 is the high-contrast one.
  // That is radix-ui/themes' model: its components read `--<scale>-a11` and
  // reach for step 12 only inside `.rt-high-contrast`. Promoting 11 to 12
  // wherever 11 missed 4.5 was the inverse, and it is why five migration
  // groups independently pinned step 11 for status text: 12 as the default
  // reads near-black in light and stops carrying the hue.
  //
  // CAVEAT, and the reason the vivid ledger does not empty: Radix's step 11
  // is designed against THEIR grounds, which are steps 1 to 2 of the same
  // hue on a near-white page. Ours are slate 2 to 4 after the surface
  // stretch, so hue 11 measures 3.7 to 4.4 off the card. Those cells are
  // ledgered against this token now rather than against a separate one.
  const hueText = hueValue(scale => at(scale, 11));
  // The high-contrast step, and what the platform's 7.0 small-text bar needs.
  const hueTextSmall = hueValue(scale => at(scale, 12));
  // Radix Themes ships this decision per scale as `--<scale>-contrast`, and
  // it is white for every scale we use except amber. Only the pale scales
  // (amber, yellow, sky, mint, lime) take a dark label there, and
  // `--sky-contrast` is `#1c2024`, the same neutral used here. Step 9 is
  // designed to carry white; maximising each hue's label ratio instead
  // produces a row with two label colours, which their own components never
  // have. The ratios white misses by are ledgered rather than designed away.
  const onFillDark = RADIX.slate.light[11]!;
  const PALE_SCALES = new Set<RadixScaleName>(['amber']);
  const hueOnFill = hueValue((_scale, _step, hue) =>
    PALE_SCALES.has(HUE_SCALE[hue]) ? onFillDark : '#ffffff'
  );
  // Equal to `hueText` now that the default is step 11. Kept emitted so the
  // consumers that pinned a vivid name keep resolving; retiring the name is
  // a separate sweep, not a rider on the step change.
  const hueTextVivid = hueText;
  return {
    hue,
    hueHover,
    hueText,
    hueTextSmall,
    hueOnFill,
    hueTextVivid,
    hueStep: spec.hueStep,
    surfaceRamp,
    textRamp,
    lineRamp,
    surfaceRole: spec.surfaceRole,
    textRole: spec.textRole,
    lineRole: spec.lineRole,
    text: {
      fg: t(spec.textRole.fg),
      muted: at(slate, 9),
      mutedText: t(spec.textRole.mutedText),
      accentText: hueText.accent,
      okText: hueText.ok,
      warnText: hueText.warn,
      badgeText: t(3),
      redText: hueText.bad,
      mutedOnCard: t(spec.textRole.mutedOnCard),
    },
    surface: {
      chrome: s(spec.surfaceRole.chrome),
      bg: s(spec.surfaceRole.page),
      panel: s(spec.surfaceRole.panel),
      card: s(spec.surfaceRole.card),
      inset: s(spec.surfaceRole.inset),
      overlay: s(spec.surfaceRole.overlay),
      raised: s(spec.surfaceRole.raised),
    },
    line: {
      border: l(spec.lineRole.border),
      soft: l(spec.lineRole.soft),
      grid: spec.grid,
      control: l(spec.lineRole.control),
      edgeOnCard: l(spec.lineRole.edgeOnCard),
      controlEdgeOnCard: l(spec.lineRole.control),
      softOnCard: l(spec.lineRole.softOnCard),
    },
    wash: spec.wash,
  };
}

const LIGHT_HUE_STEPS: Record<HueName, HueStep> = {
  accent: { fill: 9, text: 11 },
  ok: { fill: 10, text: 11 },
  bad: { fill: 9, text: 11 },
  warn: { fill: 10, text: 11 },
  purple: { fill: 9, text: 11 },
  cyan: { fill: 10, text: 11 },
  // Radix amber is a low-contrast scale: no step from 9 to 10 clears the 3.0
  // fill bar on a light surface. Step 9 keeps gold's token shape uniform and
  // the shortfall is ledgered; gold's real use is text.
  gold: { fill: 9, text: 11 },
};

const DARK_HUE_STEPS: Record<HueName, HueStep> = {
  accent: { fill: 9, text: 11 },
  ok: { fill: 9, text: 11 },
  bad: { fill: 9, text: 11 },
  warn: { fill: 9, text: 11 },
  purple: { fill: 9, text: 11 },
  cyan: { fill: 9, text: 11 },
  gold: { fill: 9, text: 11 },
};

export const TOKENS: Tokens = {
  light: buildScheme({
    scheme: 'light',
    // Slate 2, 3, 4 rather than 1, 2, 3: on 1..3 the four light surfaces
    // measure 16.39 to 14.41 against text-1 and read as one white.
    surfaceSteps: ['#ffffff', 2, 3, 4],
    // text-4 shares slate 11 with text-2/text-3 rather than promoting to 12:
    // 11's worst case (4.86 here) is rendered-legible at 10.5-12px, and 12
    // is where text-1 already sits, which is the collision this fixes.
    textSteps: [12, 11, 11, 11],
    lineSteps: [8, 7, 6],
    surfaceRole: {
      card: 1,
      panel: 2,
      page: 3,
      chrome: 4,
      inset: 3,
      overlay: 2,
      raised: 4,
    },
    textRole: { fg: 1, mutedText: 3, mutedOnCard: 3 },
    lineRole: { border: 2, soft: 3, control: 1, edgeOnCard: 2, softOnCard: 3 },
    hueStep: LIGHT_HUE_STEPS,
    grid: 'rgba(52, 59, 88, 0.05)',
    wash: '10%',
  }),
  dark: buildScheme({
    scheme: 'dark',
    surfaceSteps: [1, 2, 3, 4],
    textSteps: [12, 11, 11, 11],
    lineSteps: [9, 7, 6],
    surfaceRole: {
      card: 3,
      panel: 2,
      page: 1,
      chrome: 2,
      inset: 1,
      // A modal ground must separate from what it covers. Dark's page is the
      // darkest surface, so an overlay one rung below the panel lands on the
      // page's own hex and the dialog has no edge at all.
      overlay: 3,
      raised: 4,
    },
    textRole: { fg: 1, mutedText: 3, mutedOnCard: 3 },
    lineRole: { border: 2, soft: 3, control: 1, edgeOnCard: 1, softOnCard: 2 },
    hueStep: DARK_HUE_STEPS,
    grid: 'rgba(122, 162, 247, 0.06)',
    wash: '15%',
  }),
  font: {
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    baseSize: '13.5px',
    lineHeight: '1.55',
  },
};

// Dot-path (e.g. 'light.text.fg') into TOKENS, keyed to the exact CSS text an
// emitter must print in place of the six-digit canonical value at that path.
// Empty now that text-1 is slate 12 rather than the historical `#222`; the
// mechanism stays for the next spelling that has to survive a migration.
export const CSS_TEXT: Record<string, string> = {};
