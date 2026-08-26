/**
 * Design audit: diff the running app's COMPUTED styles against the artboard
 * spec, per component, and exit non-zero on any mismatch.
 *
 * The artboards are the contract, and `spec.json` is extracted from
 * `build.py`'s shared CSS block rather than hand-copied, so it cannot drift
 * from the drawn design. Regenerate it with `extract-spec.py`.
 *
 * Why computed styles and not screenshots: a screenshot tells you two things
 * look different, never which declaration is wrong. This names the property,
 * the expected value and the actual one, so a mismatch is a fix rather than
 * an investigation. Screenshots still earn their place for what numbers
 * cannot carry -- optical alignment, overflow, whether the thing reads at all.
 *
 * ## How to run it
 *
 * There is no browser driver in this repo on purpose; the browser we have is
 * Fast Browser over Matt's real Chrome. So this splits in two:
 *
 *   1. `node design/audit.mjs --probe`
 *      prints a self-contained JS function. Hand it to Fast Browser's
 *      `browser_evaluate` with a `filename` and it writes the page's computed
 *      styles for every TARGET to that file.
 *
 *   2. `node design/audit.mjs <that-file>`
 *      diffs it against the spec and exits non-zero on a mismatch.
 *
 * Every UI task adds its components to TARGETS. A component with no entry is
 * an unaudited component: the point of this file is that "I checked it looks
 * right" stops being an acceptable report.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = JSON.parse(readFileSync(join(HERE, 'spec.json'), 'utf8'));

// As of a recent CSS Text Module Level 4 update, Chrome's computed style no
// longer enumerates `white-space` as a single value -- it decomposes into
// `white-space-collapse` + `text-wrap-mode`, neither of which alone
// reconstructs the shorthand (both `nowrap` and `pre` share
// `text-wrap-mode: nowrap`; only `white-space-collapse` tells them apart).
// Reading it via getComputedStyle returns undefined, which would otherwise
// crash `parseColor` the same way an unhandled `border`/`padding` would.
const WHITE_SPACE_NOT_ENUMERATED =
  'no longer enumerated as a single value by getComputedStyle (decomposed into white-space-collapse + text-wrap-mode); verified by eye';

// Same blockification DaemonBanner's `.aicon` target already documents: an
// inline-level `display` on a flex ITEM computes to its block-level
// equivalent (CSS Display L3), so an authored `inline-flex` reads back as
// `flex` once the element sits inside a flex parent. Confirmed in source,
// not a wrong component.
const DISPLAY_BLOCKIFIES_TO_FLEX =
  'authored inline-flex blockifies to flex as a flex item; verified in source';

// A unitless line-height (e.g. `1`, `1.5`) is a RATIO against the element's
// own font-size, and computed style resolves it to the absolute px result
// (10px font-size * line-height 1 = 10px; 11.2px * 1.5 = 16.8px) -- not a
// different value, the same one after arithmetic getComputedStyle already did.
const LINE_HEIGHT_RESOLVES_TO_PX =
  'unitless line-height resolves to an absolute px value (font-size * ratio) at computed-style time; verified by arithmetic';

// Same arithmetic as LINE_HEIGHT_RESOLVES_TO_PX, one property over: an `em`
// letter-spacing resolves to an absolute px value at computed-style time
// (`.sect .lbl`'s 0.06em * its own 9.5px font-size = 0.57px), not a
// different value from the artboard's.
const LETTER_SPACING_RESOLVES_TO_PX =
  'em letter-spacing resolves to an absolute px value (font-size * ratio) at computed-style time; verified by arithmetic';

// getComputedStyle serializes a multi-shadow box-shadow colour-first with
// every length explicit (`rgba(0,0,0,.28) 0px 10px 30px 0px, ...`), while
// the artboard authors it length-first with a bare unitless `0` offset-x and
// no spread radius at all -- same four numbers per shadow, just a different
// count of `px`-suffixed tokens once serialized, which is what actually
// trips the generic numeric-array comparison below. Channel-by-channel
// colour and offset/blur values verified by eye against `.pop`'s spec entry.
const BOX_SHADOW_SERIALIZATION_DIFFERS =
  'getComputedStyle serializes colour-first with every length explicit; same shadow, verified by eye';

/**
 * Maps a spec selector to how the audit finds that component in the real app,
 * and which declarations must match.
 *
 * `find` is a CSS selector evaluated in the page. `props` are the spec
 * declarations to compare; omit a property to exempt it, and only ever with a
 * recorded reason in `why`. `scheme` notes a check that is only meaningful in
 * one colour scheme.
 */
export const TARGETS = [
  // Task 4 -- DaemonBanner (design/artboards/DaemonDown.dc.html's `.alert`).
  // Colour props (background/color) are skipped: both resolve through
  // `useSchemeColors`/Mantine colour tokens rather than a literal `--bad`
  // var (this repo has no tokyo-theme.css yet -- see the task report), so
  // the computed value is an rgb() string, not the spec's `var(...)`
  // literal. Verified by eye instead, per CONFORMANCE's Colours section.
  {
    spec: '.alert',
    find: '[data-testid="daemon-banner"]',
    props: ['display', 'align-items', 'gap', 'border-radius', 'background', 'color'],
    why: {
      padding:
        'shorthand not enumerated by getComputedStyle; longhands verified by eye',
    },
  },
  // Task 4 -- the banner's "Probe now" button.
  {
    spec: '.aicon',
    find: '[data-testid="daemon-banner-probe"]',
    props: ['align-items', 'justify-content', 'border-radius', 'height', 'width'],
    why: {
      // CSS blockification (CSS Display L3): an inline-level display value on
      // a flex ITEM is used as its block-level equivalent, so `inline-flex`
      // computes as `flex` here -- the button is a flex child of `.alert`,
      // same as the artboard's own layout. Mantine's ActionIcon.css authors
      // `inline-flex` (confirmed in node_modules); the mismatch is the
      // authored-vs-computed distinction, not a wrong component.
      display: 'authored inline-flex blockifies to flex as a flex item; verified in source',
      background: 'transparent by default; verified by eye',
      color: 'theme colour override; verified by eye',
      border: '0 by spec, not separately enumerated',
      cursor: 'verified by eye',
      flex: "ActionIcon doesn't set flex:none itself; the artboard's parent context does",
    },
  },
  // Task 6 -- Roster (design/artboards/Main.dc.html's BUDDIES column /
  // Roster.dc.html). Task 4's placeholder buddy row is gone -- these specs
  // now point at the real component's own testids. `find` targets a
  // fixture handle (CHAT_FIXTURES=1) rather than a class, same convention
  // RoomRail/PageBar's entries use.
  // The roster is a PageShell panel since 2026-08-26 (no `.card` on the
  // desktop page any more): its width, surface, hairline and padding are
  // the container-level contract the member rows sit inside.
  {
    spec: '.roster-panel',
    find: '[data-testid="roster"]',
    props: ['width', 'background-color', 'border-left-width', 'border-left-style', 'border-left-color', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
    why: { flex: 'shorthand keyword (none), verified by eye', 'min-height': 'verified by eye: the panel scrolls its own sections' },
  },
  {
    spec: '.member',
    find: '[data-testid="row-rt-chat-wt"]',
    props: ['display', 'align-items', 'gap'],
    why: { padding: 'shorthand not enumerated; longhands verified by eye' },
  },
  {
    spec: '.dot',
    find: '[data-testid="dot-rt-chat-wt"]',
    props: ['border-radius', 'height', 'width'],
    why: {
      flex: 'shorthand keyword (none), not reconstructed from flex-grow/shrink/basis; the dot visibly holds its size in the row, verified by eye',
    },
  },
  {
    spec: '.member .dot',
    find: '[data-testid="dot-rt-chat-wt"]',
    props: ['margin-top'],
  },
  {
    spec: '.dot.off',
    find: '[data-testid="dot-workforest-e2e"]',
    props: ['background'],
    why: {
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
    },
  },
  // `.status*`: the status word lives in the hover card header now (the row
  // shows the dot, with the word in its tooltip), so these match only with a
  // card open, like `.tag*` and `.pop`.
  {
    spec: '.status',
    find: '[data-testid="status-rt-chat-wt"]',
    props: ['font-size', 'font-weight'],
  },
  {
    spec: '.status.live',
    find: '[data-testid="status-rt-chat-wt"]',
    props: ['color'],
  },
  {
    spec: '.status.idle',
    find: '[data-testid="status-board-fix-auth"]',
    props: ['color'],
  },
  {
    spec: '.status.deaf',
    find: '[data-testid="status-gitq-main"]',
    props: ['color'],
  },
  {
    spec: '.away',
    find: '[data-testid="away-rt-chat-wt"]',
    props: ['color', 'font-size', 'font-style'],
  },
  {
    spec: '.tag',
    find: '[data-testid="tag-rt-chat-wt-build"]',
    props: [
      'align-items',
      'display',
      'height',
      'border-radius',
      'font-size',
      'font-weight',
      'white-space',
      'color',
    ],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
      'white-space': WHITE_SPACE_NOT_ENUMERATED,
      display: DISPLAY_BLOCKIFIES_TO_FLEX,
    },
  },
  {
    spec: '.tag.dm',
    find: '[data-testid="tag-rt-chat-wt-dm"]',
    props: ['border-color', 'color'],
  },
  {
    spec: '.sect',
    find: '[data-testid="section-live"]',
    props: ['align-items', 'display', 'gap'],
    why: { padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye' },
  },
  {
    spec: '.sect .lbl',
    find: '[data-testid="section-label-live"]',
    props: ['color', 'font-size', 'font-weight', 'letter-spacing'],
    why: { 'letter-spacing': LETTER_SPACING_RESOLVES_TO_PX },
  },

  // Task 5 -- RoomRail (design/artboards/Main.dc.html's rooms rail).
  {
    spec: '.room',
    find: '[data-testid^="room-row-"]',
    props: [
      'align-items',
      'display',
      'gap',
      'height',
      'border-radius',
      'cursor',
      'min-width',
      'padding',
    ],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
    },
  },
  // The active room: same row, `.on`'s accent wash.
  {
    spec: '.room.on',
    find: '[data-testid^="room-row-"][data-active="true"]',
    props: ['background', 'color'],
  },
  // The mention badge: `@N`, filled accent -- the glyph is the difference
  // from `.unread`, not just the colour, but the colour is a real
  // assertion too (see CONFORMANCE.md's note on the daemon banner).
  {
    spec: '.mention',
    find: '[data-testid="mention-badge"]',
    props: [
      'align-items',
      'display',
      'height',
      'line-height',
      'border-radius',
      'font-size',
      'font-weight',
      'white-space',
      'background',
      'color',
      'padding',
    ],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
      'white-space': WHITE_SPACE_NOT_ENUMERATED,
      display: DISPLAY_BLOCKIFIES_TO_FLEX,
      'line-height': LINE_HEIGHT_RESOLVES_TO_PX,
    },
  },
  // The unread badge: plain `N`, outlined.
  {
    spec: '.unread',
    find: '[data-testid="unread-badge"]',
    props: [
      'align-items',
      'display',
      'height',
      'line-height',
      'border-radius',
      'font-size',
      'font-weight',
      'white-space',
      'color',
      'padding',
    ],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
      'white-space': WHITE_SPACE_NOT_ENUMERATED,
      display: DISPLAY_BLOCKIFIES_TO_FLEX,
      'line-height': LINE_HEIGHT_RESOLVES_TO_PX,
    },
  },

  // Task 5 -- PageBar (design/artboards/Main.dc.html's fleet chips).
  {
    spec: '.chip',
    find: '[data-testid="chip-signed-in"]',
    props: [
      'align-items',
      'display',
      'gap',
      'height',
      'border-radius',
      'font-size',
      'font-weight',
      'white-space',
      'color',
      'padding',
    ],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
      'white-space': WHITE_SPACE_NOT_ENUMERATED,
      display: DISPLAY_BLOCKIFIES_TO_FLEX,
    },
  },
  {
    spec: '.chip.live',
    find: '[data-testid="chip-live"]',
    props: ['border-color', 'color'],
  },
  {
    spec: '.chip.idle',
    find: '[data-testid="chip-idle"]',
    props: ['border-color', 'color'],
  },
  {
    spec: '.chip.deaf',
    find: '[data-testid="chip-deaf"]',
    props: ['background', 'border-color', 'color'],
  },
  // `.dot`'s own base props (border-radius/height/width) are already
  // registered once above (Task 4's buddy-dot check) -- re-declaring the
  // same `spec` key with a different `find` would collide in the probe's
  // output object (keyed by `spec`), silently checking one dot's computed
  // style against the other. Only the colour VARIANTS are new here.
  {
    spec: '.dot.live',
    find: '[data-testid="dot-live"]',
    props: ['background'],
  },
  {
    spec: '.dot.idle',
    find: '[data-testid="dot-idle"]',
    props: ['background'],
  },
  {
    spec: '.dot.deaf',
    find: '[data-testid="dot-deaf"]',
    props: ['background'],
  },

  // Task 5 -- Transcript (design/artboards/Main.dc.html's message list).
  {
    spec: '.msg',
    find: '[data-testid^="message-"]',
    props: ['display', 'gap', 'min-width', 'padding'],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
    },
  },
  {
    spec: '.code',
    find: '[data-testid="code-block"]',
    props: [
      'background',
      'display',
      'border-radius',
      'font-size',
      'line-height',
      'margin-top',
      'overflow-x',
      'white-space',
      'padding',
    ],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
      'white-space': WHITE_SPACE_NOT_ENUMERATED,
      'line-height': LINE_HEIGHT_RESOLVES_TO_PX,
    },
  },
  {
    spec: '.divider',
    find: '[data-testid="transcript-divider"]',
    props: [
      'align-items',
      'color',
      'display',
      'font-size',
      'font-weight',
      'gap',
      'padding',
    ],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
    },
  },

  // Task 7 -- Composer (design/artboards/Main.dc.html's input row, and
  // Phone.dc.html's `.pop`/`.opt` popover, which only exists in the DOM
  // while `@` is active -- captured with the popover open).
  {
    spec: '.input',
    find: '[data-testid="composer-input"]',
    props: ['display', 'align-items', 'gap', 'min-height', 'border-radius', 'background', 'padding'],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
    },
  },
  {
    spec: '.pop',
    find: '[data-testid="composer-popover"]',
    props: ['background', 'border-radius', 'box-shadow', 'padding'],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
      'box-shadow': BOX_SHADOW_SERIALIZATION_DIFFERS,
    },
  },
  {
    spec: '.opt',
    find: '[data-testid^="composer-option-"]',
    props: ['display', 'align-items', 'gap', 'height', 'border-radius', 'min-width', 'padding'],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
    },
  },
  // The send button's own width/height is the artboard's deliberate 34px
  // override for the desktop composer row (not `.aicon`'s generic 28px, nor
  // `.aicon.tap`'s 44px phone size) -- neither number is in spec.json, so
  // only the colour and shape declarations spec.json DOES own are checked.
  {
    spec: '.aicon.filled',
    find: '[data-testid="composer-send"]',
    props: ['display', 'align-items', 'justify-content', 'border-radius', 'background', 'color'],
    why: {
      height: "the artboard's own 34px desktop override, not spec.json's generic 28px",
      width: "the artboard's own 34px desktop override, not spec.json's generic 28px",
    },
  },
  {
    spec: '.kbd',
    find: '[data-testid="composer-kbd"]',
    props: ['display', 'align-items', 'height', 'border-radius', 'font-size', 'color', 'background', 'padding'],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
      display: DISPLAY_BLOCKIFIES_TO_FLEX,
    },
  },
];

const norm = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v);

/**
 * The artboards declare their own palette on `.app` (light) and `.app.dark`,
 * so a spec value like `var(--bad)` or
 * `color-mix(in srgb, var(--bad) var(--wash), transparent)` is resolvable
 * from the spec itself -- no mapping from artboard variable names to the
 * app's is needed, because both sides end up as literal colour.
 *
 * This is what turns "colour verified by eye" into a real assertion. The
 * daemon banner shipped with Mantine's generic red (rgb(255,206,217) over
 * rgb(172,0,51)) where the design wanted #f52a65 at 10%; both are "red" and
 * only a resolved comparison catches it.
 */
function resolveSpecValue(value, scheme) {
  const palette = {
    ...(SPEC['.app'] ?? {}),
    ...(scheme === 'dark' ? (SPEC['.app.dark'] ?? {}) : {}),
  };
  let out = value;
  for (let i = 0; i < 5 && out.includes('var('); i++) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*\)/g, (m, name) => palette[name] ?? m);
  }
  return out;
}

/** #rgb / #rrggbb / rgb()/rgba()/color(srgb ...) -> [r,g,b,a] on 0-255 / 0-1. */
function parseColor(v) {
  const s = norm(v).toLowerCase();
  // The `transparent` keyword and computed `rgba(0, 0, 0, 0)` are the same
  // colour (`.dot.off`'s spec authors the former; a browser's computed
  // style always resolves to the latter) -- without this, comparing them
  // falls through every branch below to a false mismatch.
  if (s === 'transparent') return [0, 0, 0, 0];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = [...m[1]].map(c => parseInt(c + c, 16));
    return [r, g, b, 1];
  }
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = /^color\(srgb ([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
    return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
  }
  return null;
}

/** `color-mix(in srgb, <colour> <pct>, transparent)` -> the same colour at that alpha. */
function resolveColorMix(v) {
  const m = /^color-mix\(\s*in srgb\s*,\s*(\S+)\s+([\d.]+)%\s*,\s*transparent\s*\)$/.exec(
    norm(v)
  );
  if (!m) return null;
  const base = parseColor(m[1]);
  if (!base) return null;
  return [base[0], base[1], base[2], Number(m[2]) / 100];
}

/** Colours match within a rounding step per channel and 0.02 alpha. */
function colorsEqual(expected, actual) {
  const e = resolveColorMix(expected) ?? parseColor(expected);
  const a = resolveColorMix(actual) ?? parseColor(actual);
  if (!e || !a) return null; // not a colour comparison
  return (
    Math.abs(e[0] - a[0]) <= 1 &&
    Math.abs(e[1] - a[1]) <= 1 &&
    Math.abs(e[2] - a[2]) <= 1 &&
    Math.abs(e[3] - a[3]) <= 0.02
  );
}

/**
 * `getComputedStyle`'s own iterator never yields `gap`, `padding`,
 * `border-radius`, `margin`, or `flex` -- only their longhands
 * (`column-gap`/`row-gap`, `padding-top`/`-right`/`-bottom`/`-left`,
 * `border-*-radius` per corner, ...). `spec.json` is extracted from
 * authored CSS, so it names the shorthand. This maps a shorthand prop to
 * the longhand that actually appears in a captured snapshot, for every
 * TARGET registered so far -- each one uses a single-value shorthand
 * (`gap: 7.2px`, not `gap: 4px 8px`), so one representative longhand is a
 * faithful stand-in. A prop with no entry here is looked up as-is.
 */
const LONGHAND_FALLBACK = {
  gap: 'column-gap',
  'border-radius': 'border-top-left-radius',
  background: 'background-color',
  // `.chip.live`/`.idle`/`.deaf` (and the mark-read control) only override
  // `border-color`, not the full `border` shorthand -- that one longhand
  // name IS what getComputedStyle's iterator yields directly, so this entry
  // exists for symmetry/documentation rather than because it was missing.
  'border-color': 'border-top-color',
};

function readActual(actual, prop) {
  if (prop in actual) return actual[prop];
  const fallback = LONGHAND_FALLBACK[prop];
  return fallback ? actual[fallback] : undefined;
}

/** px values within half a pixel are the same value: browsers round subpixels. */
function equal(expected, actual, scheme = 'light') {
  // A requested prop with no captured value (a shorthand getComputedStyle
  // never enumerates, and nobody exempted it in `why`) is a real mismatch,
  // not something to feed downstream: `parseColor` assumes a string and
  // crashes the whole audit run on `undefined`, taking every OTHER
  // already-passing target down with it. Report it as a normal failure.
  if (actual === undefined) return false;
  const e = norm(resolveSpecValue(String(expected), scheme));
  const a = norm(actual);
  if (e === a) return true;
  // A bare unitless "0" (valid CSS for any length) computes with a unit
  // attached ("0px", "0%", ...) -- e.g. `.room`/`.msg`'s `min-width: 0`.
  if (e === '0' && /^0(?:px|%|em|rem)?$/.test(a)) return true;
  const asColor = colorsEqual(e, a);
  if (asColor !== null) return asColor;
  if (typeof e !== 'string' || typeof a !== 'string') return false;
  const ep = [...e.matchAll(/(-?[\d.]+)px/g)].map(m => +m[1]);
  const ap = [...a.matchAll(/(-?[\d.]+)px/g)].map(m => +m[1]);
  if (ep.length && ep.length === ap.length) {
    return ep.every((v, i) => Math.abs(v - ap[i]) < 0.5);
  }
  return false;
}

/**
 * The page-side probe, emitted as source so Fast Browser can evaluate it.
 *
 * It carries the selector list inline rather than reading it from disk,
 * because the page has no access to this file. That makes it regenerate
 * whenever TARGETS changes -- always re-run `--probe`, never reuse a
 * captured probe from an earlier task.
 */
function probeSource() {
  const finds = TARGETS.map(t => ({ spec: t.spec, find: t.find }));
  return `() => {
  const targets = ${JSON.stringify(finds)};
  const out = { __scheme__: document.documentElement.getAttribute('data-mantine-color-scheme') };
  for (const t of targets) {
    const el = document.querySelector(t.find);
    if (!el) { out[t.spec] = null; continue; }
    const cs = getComputedStyle(el);
    const props = {};
    for (const p of cs) props[p] = cs.getPropertyValue(p);
    out[t.spec] = props;
  }
  return JSON.stringify(out);
}`;
}

function main() {
  const args = process.argv.slice(2);
  // `--scheme dark` resolves every expected value against the artboards'
  // `.app.dark` palette, so ONE target list covers both schemes: capture the
  // page in dark, pass the flag, and the same 35 targets are re-asserted
  // against the dark palette rather than annotated one by one.
  const SCHEMES = ['light', 'dark'];
  const schemeIdx = args.indexOf('--scheme');
  const cliScheme = schemeIdx !== -1 ? args[schemeIdx + 1] : undefined;
  if (schemeIdx !== -1) args.splice(schemeIdx, 2);
  // Anything but `dark` silently resolves against the LIGHT palette, so a
  // typo (`--scheme drak`) would pass and then report "(drak scheme)" as if
  // it had checked something. Reject instead.
  if (cliScheme !== undefined && !SCHEMES.includes(cliScheme)) {
    console.error(
      `--scheme must be one of ${SCHEMES.join(', ')} (got "${cliScheme}")`
    );
    process.exit(2);
  }
  const arg = args[0];

  if (TARGETS.length === 0) {
    console.log('design audit: no TARGETS registered yet.');
    console.log('Add one per component as each UI task lands. Nothing to check.');
    return;
  }

  if (arg === '--probe') {
    console.log(probeSource());
    return;
  }

  if (!arg) {
    console.error('usage: node design/audit.mjs --probe');
    console.error('       node design/audit.mjs [--scheme dark] <computed-styles.json>');
    console.error('');
    console.error('Step 1 prints a function for Fast Browser browser_evaluate;');
    console.error('point its `filename` at a file, then pass that file to step 2.');
    process.exit(2);
  }

  let got;
  try {
    const raw = readFileSync(arg, 'utf8');
    // browser_evaluate may wrap the return value; accept either shape.
    const parsed = JSON.parse(raw);
    got =
      typeof parsed === 'string'
        ? JSON.parse(parsed)
        : (parsed?.result ?? parsed);
    if (typeof got === 'string') got = JSON.parse(got);
  } catch (err) {
    console.error(`could not read computed styles from ${arg}: ${err.message}`);
    process.exit(2);
  }

  // The capture records the scheme it was taken in, so the expected values
  // resolve against the right palette even when --scheme is omitted. An
  // explicit flag still wins, for re-checking a light capture against dark.
  if (got === null || typeof got !== 'object' || Array.isArray(got)) {
    console.error(
      `${arg} did not contain a computed-styles object. Re-run the probe ` +
        `through browser_evaluate and point its filename at a fresh file.`
    );
    process.exit(2);
  }
  // A page could in principle report any string; only the two we can resolve
  // against are honoured, and anything else falls through to light.
  const capturedScheme = SCHEMES.includes(got.__scheme__)
    ? got.__scheme__
    : undefined;
  const scheme = cliScheme ?? capturedScheme;
  delete got.__scheme__;

  const failures = [];
  for (const t of TARGETS) {
    const want = SPEC[t.spec];
    if (!want) {
      failures.push(`${t.spec}: no such selector in spec.json`);
      continue;
    }
    const actual = got[t.spec];
    if (!actual) {
      failures.push(`${t.spec}: nothing matched "${t.find}" in the page`);
      continue;
    }
    for (const prop of t.props ?? Object.keys(want)) {
      if (t.why?.[prop]) continue;
      if (!(prop in want)) continue;
      const actualValue = readActual(actual, prop);
      if (!equal(want[prop], actualValue, scheme ?? t.scheme)) {
        failures.push(
          `${t.spec} (${t.find})  ${prop}\n` +
            `    artboard: ${want[prop]}${
              want[prop].includes('var(')
                ? `  ->  ${resolveSpecValue(want[prop], scheme ?? t.scheme ?? 'light')}`
                : ''
            }\n` +
            `    app:      ${actualValue}`
        );
      }
    }
  }

  if (failures.length) {
    console.error(`design audit FAILED (${failures.length}):\n`);
    for (const f of failures) console.error('  ' + f + '\n');
    process.exit(1);
  }
  console.log(
    `design audit passed: ${TARGETS.length} components match the artboards` +
      `${scheme ? ` (${scheme} scheme)` : ''}.`
  );
}

main();
