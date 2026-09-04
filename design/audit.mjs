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
 *   2. `node design/audit.mjs <that-file> [<more-files>...]`
 *      diffs it against the spec and exits non-zero on a mismatch.
 *
 * No single page state holds every component at once: a menu's items exist
 * only while it is open, the inbox and a room are different routes, and the
 * daemon banner only exists while the daemon is down. So the probe may be run
 * several times over one page, once per state, and step 2 takes all the
 * captures together -- a target counts as found if any capture saw it. The
 * captures must agree on colour scheme and on viewport, since both change what
 * the expected values resolve to.
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
// A <button> imposes its own inner display, so an authored `-webkit-box`
// reads back as `flow-root`. The line clamp still applies through it: a
// twelve-line excerpt in the inbox card still renders at two lines.
const DISPLAY_BLOCKIFIES_ON_BUTTON =
  'a <button> forces its own inner display, so an authored -webkit-box computes as flow-root; the clamp still applies, measured on an overlong excerpt';

const FONT_FAMILY_QUOTING_DIFFERS =
  'serialized with double quotes; same stack, verified by eye';

const BOX_SHADOW_SERIALIZATION_DIFFERS =
  'getComputedStyle serializes colour-first with every length explicit; same shadow, verified by eye';

// The app switches shells at Mantine's `sm` breakpoint (`useIsMobile`), so a
// capture 768px wide or narrower is the phone shell and a wider one is the
// desktop layout. Most components live in exactly one of them.
export const PHONE_MAX_WIDTH = 768;
const DESKTOP = 'desktop';
const PHONE = 'phone';
const BOTH = 'both';

/**
 * Maps a spec selector to how the audit finds that component in the real app,
 * and which declarations must match.
 *
 * `find` is a CSS selector evaluated in the page. `props` are the spec
 * declarations to compare; omit a property to exempt it, and only ever with a
 * recorded reason in `why`. `at` is the viewport the component exists in
 * (default `desktop`). `scheme` notes a check that is only meaningful in one
 * colour scheme.
 *
 * Two entries may share a `spec` key: a capture is keyed by position in this
 * list, not by selector, so `.chip` on the page bar and `.chip` in the inbox
 * bar are separate assertions rather than one silently overwriting the other.
 */
export const TARGETS = [
  // DaemonBanner (design/artboards/DaemonDown.dc.html's `.alert`). It only
  // exists while the daemon is unreachable, so the capture takes it last.
  {
    spec: '.alert',
    find: '[data-testid="daemon-banner"]',
    props: ['display', 'align-items', 'gap', 'border-radius', 'background', 'color'],
    why: {
      padding:
        'shorthand not enumerated by getComputedStyle; longhands verified by eye',
    },
  },
  // The banner's "Probe now" button.
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
  // The hover card (design/artboards/Fleet.dc.html): the one place a handle
  // still spells itself out. `find` names a fixture handle (CHAT_FIXTURES=1),
  // the same convention the tree and page bar entries use. These match only
  // while a card is open, like `.pop` and the menu items.
  {
    spec: '.status',
    find: '[data-testid="status-max"]',
    at: DESKTOP,
    props: ['font-size', 'font-weight'],
  },
  {
    spec: '.status.live',
    find: '[data-testid="status-max"]',
    at: DESKTOP,
    props: ['color'],
  },
  {
    spec: '.status.idle',
    find: '[data-testid="status-remy"]',
    at: DESKTOP,
    props: ['color'],
  },
  {
    spec: '.tag',
    find: '[data-testid="tag-max-rt"]',
    at: DESKTOP,
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
    find: '[data-testid="tag-max-dm"]',
    at: DESKTOP,
    props: ['border-color', 'color'],
  },
  // The card's `repo / where / path / seen / rooms` grid.
  {
    spec: '.kv',
    find: '[data-testid^="detail-"] dl',
    at: DESKTOP,
    props: ['align-items', 'display', 'grid-template-columns', 'column-gap', 'row-gap'],
    why: {
      'grid-template-columns':
        'the used value resolves the `minmax(0, 1fr)` track to the px it got; the 52px label track is the assertion, verified by eye',
    },
  },
  {
    spec: '.kv .k',
    find: '[data-testid^="detail-"] dt',
    at: DESKTOP,
    props: ['color', 'font-size', 'font-weight', 'letter-spacing', 'text-transform'],
    why: { 'letter-spacing': LETTER_SPACING_RESOLVES_TO_PX },
  },

  // Fleet tree (design/artboards/Main.dc.html's sidebar). At 390 the same
  // rows are what the phone drawer holds, so these are asserted in both
  // shells and the phone capture takes them with the drawer open.
  {
    spec: '.dot',
    find: '[data-testid="dot-max"]',
    at: BOTH,
    props: ['border-radius', 'height', 'width'],
    why: {
      flex: 'shorthand keyword (none), not reconstructed from flex-grow/shrink/basis; the dot visibly holds its size in the row, verified by eye',
    },
  },
  {
    spec: '.dot.off',
    find: '[data-testid^="dot-offline-"]',
    at: BOTH,
    props: ['background'],
    why: {
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
    },
  },
  {
    spec: '.ws',
    find: '[data-testid^="ws-"]:not([data-testid^="ws-handle-"]):not([data-testid^="ws-doing-"])',
    at: BOTH,
    props: ['align-items', 'display', 'gap', 'height', 'border-radius', 'cursor', 'min-width', 'overflow'],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
    },
  },
  {
    spec: '.ws .h',
    find: '[data-testid^="ws-handle-"]',
    at: BOTH,
    props: ['font-size', 'font-weight'],
    why: { flex: 'shorthand keyword (none), not enumerated; verified by eye' },
  },
  // The offline roll-up. `.ws.on` has no entry on purpose: nothing in this
  // design selects a workstream, so the rule is unreachable in the app.
  {
    spec: '.ws.more',
    find: '[data-testid^="offline-"]',
    at: BOTH,
    props: ['color', 'cursor', 'font-size', 'height'],
  },
  {
    spec: '.ws.more span',
    find: '[data-testid^="offline-"] > span:last-child',
    at: BOTH,
    props: ['min-width', 'overflow', 'text-overflow', 'white-space'],
    why: { 'white-space': WHITE_SPACE_NOT_ENUMERATED },
  },
  // The task line, in both tones: `edie` has a live pane title, `max`'s pane
  // title is just its handle on a `main` branch, which falls through to the
  // dimmer worktree-folder form.
  {
    spec: '.doing',
    find: '[data-testid="ws-doing-edie"]',
    at: BOTH,
    props: ['color', 'font-size', 'min-width', 'overflow', 'text-overflow', 'white-space'],
    why: { 'white-space': WHITE_SPACE_NOT_ENUMERATED },
  },
  {
    spec: '.doing.dim',
    find: '[data-testid="ws-doing-max"]',
    at: BOTH,
    props: ['color'],
  },
  // A repo with agents but no room heads its group with a plain label.
  {
    spec: '.grp',
    find: '[data-testid^="repo-name-"]',
    at: BOTH,
    props: ['color', 'font-size'],
  },
  {
    spec: '.dm2',
    find: '[data-testid^="dm-row-"]',
    at: BOTH,
    props: ['display', 'flex-direction', 'gap', 'border-radius', 'cursor', 'min-width', 'overflow'],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
    },
  },
  {
    spec: '.dm2 .close',
    find: '[data-testid^="dm-close-"]',
    at: DESKTOP,
    props: ['width', 'height', 'border-radius', 'align-items', 'justify-content', 'color', 'display'],
    why: {
      background: 'transparent until hover; verified by eye',
      border: '0, not separately enumerated',
      flex: 'set by the row, not the control',
      cursor: 'verified by eye',
    },
  },

  // The room row heading each repo group (design/artboards/Main.dc.html's
  // sidebar), and the phone drawer's copy of the same tree.
  {
    spec: '.room',
    find: '[data-testid^="room-row-"]',
    at: BOTH,
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
    at: BOTH,
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
    at: BOTH,
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

  // PageBar (design/artboards/Main.dc.html's fleet chips).
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
    spec: '.chip.offline',
    find: '[data-testid="chip-offline"]',
    props: ['border-color', 'color'],
  },
  // `.dot`'s own geometry is registered once above, on the tree's dot; only
  // the colour VARIANTS are new here.
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
    spec: '.dot.offline',
    find: '[data-testid="dot-offline"]',
    props: ['background'],
    why: {
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
    },
  },

  // Reader transcript (design/artboards/Main.dc.html): the column, the row,
  // the prose module, the code panel, the human's tinted post.
  {
    spec: '.col',
    find: '[data-testid="transcript-column"]',
    props: ['max-width', 'width'],
    why: {
      margin: 'auto resolves to px at computed-style time; verified by eye',
      width:
        'percentage resolves to an absolute px value at computed-style time (100% clamped by max-width here, so the resolved number is the max-width itself); verified by eye',
    },
  },
  {
    spec: '.msg',
    find: '[data-testid^="message-"]:not([data-testid="message-body"]):not([data-testid="message-fold"])',
    props: ['display', 'min-width', 'padding'],
    why: { padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye' },
  },
  {
    spec: '.hpill',
    find: '[data-testid="speaker-chip"]',
    at: BOTH,
    props: ['border-radius'],
    why: {
      padding: 'shorthand not enumerated; longhands verified by eye',
      'margin-left': 'verified by eye',
      color: 'per-speaker hue, inline; verified by eye',
      background: 'per-speaker hue, inline; verified by eye',
    },
  },
  {
    spec: '.prose',
    find: '[data-testid="message-body"]',
    props: ['font-size', 'display', 'flex-direction', 'gap', 'min-width', 'overflow-wrap'],
    why: {
      'font-family': 'serialized with double quotes; same stack, verified by eye',
      'line-height': LINE_HEIGHT_RESOLVES_TO_PX,
    },
  },
  {
    spec: '.prose code',
    find: '[data-testid="message-body"] p > code',
    props: ['font-size', 'background', 'border-radius', 'padding'],
    why: {
      'font-family': 'serialized with double quotes; same stack, verified by eye',
      border: 'token',
      padding: 'shorthand not enumerated; longhands verified by eye',
    },
  },
  {
    spec: '.prose table',
    find: '[data-testid="message-body"] table',
    props: ['border-collapse', 'font-size'],
    why: { 'line-height': LINE_HEIGHT_RESOLVES_TO_PX },
  },
  {
    spec: '.prose th, .prose td',
    find: '[data-testid="message-body"] td',
    props: ['text-align', 'vertical-align', 'padding'],
    why: { border: 'token', padding: 'shorthand not enumerated; longhands verified by eye' },
  },
  {
    spec: '.prose th',
    find: '[data-testid="message-body"] th',
    props: ['font-weight'],
    why: { background: 'token; color prop, verified by eye' },
  },
  // No entry for `.prose h1`/`h2`/`h3`, `.prose ul, .prose ol` or `.divider`:
  // no artboard draws a prose heading or a list, and no fixture room has an
  // unread count smaller than the messages it loads (#rt draws 155 over six),
  // which is the only shape that renders the read-cursor divider. Auditing a
  // state neither side of the comparison can produce teaches the audit to be
  // ignored -- the same reason `.ws.on` has no entry.
  {
    spec: '.ch',
    find: '[data-testid="code-block"]',
    props: ['border-radius', 'overflow', 'position'],
    why: { border: 'Paper withBorder token', background: 'CodeHighlight owns it; verified by eye' },
  },
  {
    spec: '.ch pre',
    find: '[data-testid="code-block"] pre',
    props: ['font-size', 'overflow-x'],
    why: {
      'font-family': 'serialized with double quotes; same stack',
      'line-height': LINE_HEIGHT_RESOLVES_TO_PX,
      'white-space': WHITE_SPACE_NOT_ENUMERATED,
      padding: 'shorthand not enumerated; longhands verified by eye',
      margin: 'CodeHighlight resets it; verified by eye',
      width: 'fit-content resolves to px',
      'min-width': 'percentage resolves to px',
    },
  },
  {
    spec: '.msg.mine .prose',
    find: '[data-mine="true"] [data-testid="message-body"]',
    props: ['background', 'border-radius', 'padding'],
    why: { padding: 'shorthand not enumerated; longhands verified by eye' },
  },
  {
    spec: '.at.me',
    find: '[data-testid="message-body"] [data-me="true"]',
    props: ['background', 'border-radius', 'padding', 'color', 'font-weight'],
    why: { padding: 'shorthand not enumerated; longhands verified by eye' },
  },

  // Composer (design/artboards/Main.dc.html's input row, and
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

  // Day dividers, the new pill, the tall-body fold.
  {
    spec: '.day',
    find: '[data-testid="day-divider"]',
    props: ['align-items', 'color', 'display', 'font-size', 'font-weight', 'gap'],
    why: { padding: 'shorthand not enumerated; longhands verified by eye' },
  },
  {
    spec: '.pill',
    find: '[data-testid="new-pill"]',
    props: ['position', 'right', 'bottom', 'height', 'border-radius', 'font-size', 'font-weight', 'color'],
    why: {
      background: 'color-mix over the card token, verified by eye',
      border: 'verified by eye',
      padding: 'shorthand not enumerated; longhands verified by eye',
      display: 'inline-flex blockifies in some parents; verified in source',
      gap: 'verified by eye',
    },
  },
  {
    spec: '.fold',
    find: '[data-testid="message-fold"][data-folded="true"] > div',
    props: ['max-height', 'overflow', 'position'],
  },
  {
    spec: '.more',
    find: '[data-testid="fold-toggle"]',
    props: ['font-size', 'font-weight', 'color', 'margin-top'],
    why: {
      background: 'UnstyledButton, verified by eye',
      border: 'UnstyledButton',
      padding: 'UnstyledButton',
      cursor: 'verified by eye',
    },
  },

  // Close: the tree row's hover × and, on the phone, the header ⋯ and its
  // menu. The × is `display: none` until hover, so its size and shape are
  // read at rest; the menu items exist only while the menu is open, so the
  // phone capture takes them with it open (same convention as the composer
  // popover).
  {
    spec: '.room .close',
    find: '[data-testid^="room-close-"]',
    at: DESKTOP,
    props: ['width', 'height', 'border-radius', 'align-items', 'justify-content', 'color'],
    why: {
      display: 'none until hover or focus; the audit reads the resting state',
      background: 'transparent until hover; verified by eye',
      border: '0, not separately enumerated',
      flex: 'set by the row, not the control',
      'margin-right': 'verified by eye',
      cursor: 'verified by eye',
    },
  },
  // The ⋯ is 44px phone chrome, so `.aicon.tap` is its spec, not the 30px
  // `.menu` the desktop page bar used to carry -- and its items are
  // `.menu-item.tap`, not the 24px desktop item.
  {
    spec: '.aicon.tap',
    find: '[data-testid="room-menu"]',
    at: PHONE,
    props: ['width', 'height'],
  },
  {
    spec: '.menu-item.tap',
    find: '[data-testid="room-menu-close"]',
    at: PHONE,
    props: ['min-height', 'font-size'],
    why: {
      padding: 'shorthand not enumerated; longhands verified by eye',
    },
  },
  {
    spec: '.menu-dd',
    find: '[data-testid="room-menu-dropdown"]',
    at: PHONE,
    props: ['display', 'flex-direction', 'background', 'border-radius', 'padding'],
    why: {
      padding: 'shorthand not enumerated; longhands verified by eye',
      border: 'token',
      'box-shadow': BOX_SHADOW_SERIALIZATION_DIFFERS,
    },
  },

  // PanePicker (design/artboards/PanePicker.dc.html) and its
  // NewRoomModal caller (design/artboards/NewRoom.dc.html). The `.pop` shell
  // is Mantine's own Modal.Content, not a hand-rolled popover like the
  // composer's -- `mantine-Modal-content` is the static class name
  // Mantine's styles API stamps on it (`${classNamesPrefix}-${staticSelector}-${selector}`,
  // confirmed in @mantine/core's get-static-class-names.ts and ModalContent.tsx;
  // this app never overrides classNamesPrefix or withStaticClasses).
  {
    spec: '.pop',
    find: '[data-testid="pane-picker"] .mantine-Modal-content',
    props: ['background', 'border-radius', 'box-shadow', 'padding'],
    why: {
      padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye',
      border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye',
      'box-shadow': BOX_SHADOW_SERIALIZATION_DIFFERS,
    },
  },
  { spec: '.pane', find: '[data-testid^="pane-row-"]', at: DESKTOP, props: ['display', 'align-items', 'gap', 'border-radius', 'min-width', 'padding'], why: { padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye' } },
  { spec: '.cb', find: '[data-testid^="pane-check-"]', at: DESKTOP, props: ['width', 'height', 'border-radius', 'align-items', 'justify-content'], why: { display: 'authored inline-flex blockifies to flex as a flex item in the row; verified in source' } },
  { spec: '.peek', find: '[data-testid^="pane-peek-"]:not([data-testid^="pane-peek-button-"])', at: DESKTOP, props: ['padding', 'background', 'border-radius', 'font-size', 'line-height', 'white-space', 'overflow-x', 'color'], why: { padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye', 'white-space': WHITE_SPACE_NOT_ENUMERATED, 'line-height': LINE_HEIGHT_RESOLVES_TO_PX } },
  { spec: '.btn.sm', find: '[data-testid="add-agents-button"]', at: DESKTOP, props: ['height', 'font-size', 'font-weight', 'border-radius'] },
  { spec: '.notice', find: '[data-testid="transcript-notice"]', at: DESKTOP, props: ['padding', 'text-align', 'font-size', 'color'], why: { padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye' } },

  // The inbox, the landing view (design/artboards/Main.dc.html and
  // PhoneInbox.dc.html). `find` targets the card list's own testids under
  // CHAT_FIXTURES=1, same prefix-selector convention the pane picker's
  // entries use. The cards are the phone landing view too.
  { spec: '.card2', find: '[data-testid^="inbox-card-"]:not([data-open="true"])', at: BOTH, props: ['display', 'flex-direction', 'gap', 'border-radius', 'min-width', 'background', 'cursor'], why: { padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye', border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye' } },
  { spec: '.card2.on', find: '[data-testid^="inbox-card-"][data-open="true"]', at: DESKTOP, props: ['background', 'border-color'] },
  { spec: '.lead', find: '[data-testid^="card-lead-"]', at: BOTH, props: ['font-size', 'overflow', 'overflow-wrap', '-webkit-line-clamp', '-webkit-box-orient'], why: { 'line-height': LINE_HEIGHT_RESOLVES_TO_PX, display: DISPLAY_BLOCKIFIES_ON_BUTTON, 'font-family': FONT_FAMILY_QUOTING_DIFFERS } },
  // `.ctx` in all three tones: a room chip, a DM's purple, and the
  // transcript's unclaimed-`@here` warning.
  { spec: '.ctx', find: '[data-testid^="inbox-elsewhere-room-"]', at: BOTH, props: ['align-items', 'height', 'border-radius', 'font-size', 'font-weight', 'white-space', 'color'], why: { display: 'authored inline-flex blockifies to flex as a flex item in the meta row; verified in source', padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye', border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye', 'white-space': WHITE_SPACE_NOT_ENUMERATED } },
  { spec: '.ctx.dm', find: '[data-testid="inbox-elsewhere-dm"]', at: BOTH, props: ['border-color', 'color'] },
  { spec: '.ctx.warn', find: '[data-testid="unclaimed-chip"]', at: DESKTOP, props: ['border-color', 'color'] },
  { spec: '.sect', find: '[data-testid="inbox-section-needs-you"]', at: BOTH, props: ['align-items', 'display', 'gap'], why: { padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye' } },
  { spec: '.sect .lbl', find: '[data-testid="inbox-section-needs-you"] > span:first-child', at: BOTH, props: ['color', 'font-size', 'font-weight', 'letter-spacing'], why: { 'letter-spacing': LETTER_SPACING_RESOLVES_TO_PX } },
  { spec: '.chip', find: '[data-testid="inbox-chip-elsewhere"]', at: DESKTOP, props: ['align-items', 'gap', 'height', 'border-radius', 'font-size', 'font-weight', 'white-space', 'color'], why: { padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye', border: 'full shorthand (width/style/colour combined); not separately enumerated, verified by eye', 'white-space': WHITE_SPACE_NOT_ENUMERATED, display: DISPLAY_BLOCKIFIES_TO_FLEX } },
  { spec: '.chip.live', find: '[data-testid="inbox-chip-open-asks"]', at: DESKTOP, props: ['border-color', 'color'] },
  // The avatar inside the handle chip. The artboards draw one flat 10px
  // sprite everywhere; the inbox card is the surface whose real invadr is
  // that size, so this is where the number is a contract rather than a
  // stand-in (the message header deliberately runs a 22px one).
  { spec: '.sprite', find: '[data-testid^="inbox-card-"] [data-testid="speaker-chip"] svg', at: BOTH, props: ['height', 'width'], why: { flex: 'shorthand keyword (none), not enumerated; verified by eye' } },
  // The reader: the message before the one you opened, dimmed.
  { spec: '.msg.context', find: '[data-testid="reader-context-message"]', at: BOTH, props: ['opacity'] },

  // Read messages fold to their first block, with the rest behind a
  // `.foldrow`. Nothing folds while a room is all unread, so the capture
  // takes this after a mark-read.
  { spec: '.foldrow', find: '[data-testid="read-fold-toggle"]', at: DESKTOP, props: ['align-items', 'display', 'gap', 'margin-top', 'font-size', 'font-weight', 'color', 'cursor'], why: { background: 'UnstyledButton, verified by eye', border: 'UnstyledButton', padding: 'UnstyledButton' } },
  // No entry for `.foldrow .tri`: the three borders that ARE the triangle are
  // shorthands getComputedStyle never enumerates, and its authored `width: 0`
  // / `height: 0` read back as the border box under the `border-box` sizing
  // both sides use. Nothing on it is assertable.

  // Phone chrome (Phone.dc.html / PhoneInbox.dc.html). The 56px headers are
  // drawn with their height, padding and gap inline on the artboard, so
  // `.row` is all spec.json owns of them: that the header is a nowrap row of
  // centred controls, not that it is 56px. The 44px tap floor below is the
  // number that IS in the spec.
  { spec: '.row', find: '[data-testid="phone-inbox-header"]', at: PHONE, props: ['align-items', 'display'], why: { gap: "the artboard sets the phone header's own gap inline; `.row`'s is the generic one", 'min-width': 'Group does not set it; the header truncates on its title, verified by eye' } },
  { spec: '.row', find: '[data-testid="reader-phone-header"]', at: PHONE, props: ['align-items', 'display'], why: { gap: "the artboard sets the phone header's own gap inline; `.row`'s is the generic one", 'min-width': 'Group does not set it; the header truncates on its title, verified by eye' } },
  { spec: '.aicon.tap', find: '[data-testid="phone-drawer-toggle"]', at: PHONE, props: ['width', 'height'] },
  { spec: '.aicon.tap', find: '[data-testid="reader-back"]', at: PHONE, props: ['width', 'height'] },
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

/**
 * `color-mix(in srgb, <colour> <pct>, <colour>)` -> the flat colour it makes.
 * Over `transparent` that is the same colour at that alpha (the wash the
 * artboards use everywhere); over an opaque second colour it is the blend,
 * which is what an opaque wash like `.card2.on`'s resolves to.
 */
function resolveColorMix(v) {
  const m = /^color-mix\(\s*in srgb\s*,\s*(\S+)\s+([\d.]+)%\s*,\s*(\S+)\s*\)$/.exec(
    norm(v)
  );
  if (!m) return null;
  const base = parseColor(m[1]);
  const over = parseColor(m[3]);
  if (!base || !over) return null;
  const p = Number(m[2]) / 100;
  if (over[3] === 0) return [base[0], base[1], base[2], p];
  return [
    base[0] * p + over[0] * (1 - p),
    base[1] * p + over[1] * (1 - p),
    base[2] * p + over[2] * (1 - p),
    base[3] * p + over[3] * (1 - p),
  ];
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
  // `.chip.live`/`.idle`/`.offline` (and the mark-read control) only override
  // `border-color`, not the full `border` shorthand -- that one longhand
  // name IS what getComputedStyle's iterator yields directly, so this entry
  // exists for symmetry/documentation rather than because it was missing.
  'border-color': 'border-top-color',
  // `.fold`'s rule is a single-value `overflow: hidden`, so `overflow-x`
  // (which getComputedStyle DOES enumerate) is a faithful stand-in for the
  // shorthand it never enumerates.
  overflow: 'overflow-x',
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

/** Every computed property this target's assertions will read, shorthand
    fallbacks included. Emitting only these keeps a capture small enough to
    read by eye, and is why a TARGETS edit always needs a fresh `--probe`. */
function neededProps(target) {
  const want = SPEC[target.spec] ?? {};
  const props = target.props ?? Object.keys(want);
  const out = new Set();
  for (const prop of props) {
    if (target.why?.[prop]) continue;
    out.add(prop);
    const fallback = LONGHAND_FALLBACK[prop];
    if (fallback) out.add(fallback);
  }
  return [...out];
}

/**
 * The page-side probe, emitted as source so Fast Browser can evaluate it.
 *
 * It carries the selector list inline rather than reading it from disk,
 * because the page has no access to this file. That makes it regenerate
 * whenever TARGETS changes -- always re-run `--probe`, never reuse a
 * captured probe from an earlier task.
 *
 * Results are keyed by POSITION in TARGETS, not by selector, so two entries
 * may share a `spec` (the page bar's `.chip` and the inbox bar's) without one
 * silently overwriting the other's reading.
 */
function probeSource() {
  const finds = TARGETS.map(t => ({
    spec: t.spec,
    find: t.find,
    read: neededProps(t),
  }));
  return `() => {
  const targets = ${JSON.stringify(finds)};
  const out = {
    scheme: document.documentElement.getAttribute('data-mantine-color-scheme'),
    width: window.innerWidth,
    targets: targets.map(t => {
      const el = document.querySelector(t.find);
      if (!el) return null;
      const cs = getComputedStyle(el);
      // Only what the computed style ENUMERATES. Asked for by name, a
      // shorthand like \`background\` still serializes (\`rgb(...) none repeat
      // scroll ...\`), which no artboard value can equal; leaving it out is
      // what lets the diff fall back to the longhand it does enumerate.
      const enumerated = new Set();
      for (const p of cs) enumerated.add(p);
      const props = {};
      for (const p of t.read) if (enumerated.has(p)) props[p] = cs.getPropertyValue(p);
      return props;
    }),
  };
  return JSON.stringify(out);
}`;
}

/** Unwraps whatever `browser_evaluate` wrote: the probe's JSON string, that
    string wrapped in a result envelope, or the parsed object itself. */
function parseCapture(raw) {
  let got = JSON.parse(raw);
  if (typeof got === 'string') got = JSON.parse(got);
  got = got?.result ?? got;
  if (typeof got === 'string') got = JSON.parse(got);
  return got;
}

function main() {
  const args = process.argv.slice(2);
  // `--scheme dark` resolves every expected value against the artboards'
  // `.app.dark` palette, so ONE target list covers both schemes: capture the
  // page in dark, pass the flag, and the same targets are re-asserted against
  // the dark palette rather than annotated one by one.
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

  if (TARGETS.length === 0) {
    console.log('design audit: no TARGETS registered yet.');
    console.log('Add one per component as each UI task lands. Nothing to check.');
    return;
  }

  if (args[0] === '--probe') {
    console.log(probeSource());
    return;
  }

  if (args.length === 0) {
    console.error('usage: node design/audit.mjs --probe');
    console.error('       node design/audit.mjs [--scheme dark] <capture.json> [<capture.json>...]');
    console.error('');
    console.error('Step 1 prints a function for Fast Browser browser_evaluate;');
    console.error('point its `filename` at a file, then pass that file to step 2.');
    console.error('Pass one file per page state a target needs (a menu open, the');
    console.error('inbox, a room); a target counts as found if any of them saw it.');
    process.exit(2);
  }

  const captures = [];
  for (const file of args) {
    let got;
    try {
      got = parseCapture(readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`could not read computed styles from ${file}: ${err.message}`);
      process.exit(2);
    }
    if (!got || typeof got !== 'object' || !Array.isArray(got.targets)) {
      console.error(
        `${file} did not contain a computed-styles capture. Re-run the probe ` +
          `through browser_evaluate and point its filename at a fresh file.`
      );
      process.exit(2);
    }
    if (got.targets.length !== TARGETS.length) {
      console.error(
        `${file} holds ${got.targets.length} readings for ${TARGETS.length} ` +
          `targets: it was taken with a different TARGETS list. Re-run --probe.`
      );
      process.exit(2);
    }
    captures.push({ file, ...got });
  }

  // Merging captures of different schemes or viewports would compare a dark
  // reading against a light expectation, or a phone row against a desktop
  // one, and report it as a component defect.
  const disagree = (key) =>
    captures.some(c => String(c[key]) !== String(captures[0][key]));
  if (disagree('scheme')) {
    console.error('the captures disagree on colour scheme; diff each scheme on its own.');
    process.exit(2);
  }
  const phone = captures[0].width <= PHONE_MAX_WIDTH;
  if (captures.some(c => (c.width <= PHONE_MAX_WIDTH) !== phone)) {
    console.error(
      `the captures straddle the ${PHONE_MAX_WIDTH}px shell switch; diff each width on its own.`
    );
    process.exit(2);
  }
  const viewport = phone ? PHONE : DESKTOP;

  // The capture records the scheme it was taken in, so the expected values
  // resolve against the right palette even when --scheme is omitted. An
  // explicit flag still wins, for re-checking a light capture against dark.
  // A page could in principle report any string; only the two we can resolve
  // against are honoured, and anything else falls through to light.
  const capturedScheme = SCHEMES.includes(captures[0].scheme)
    ? captures[0].scheme
    : undefined;
  const scheme = cliScheme ?? capturedScheme;

  const failures = [];
  let checked = 0;
  for (const [index, t] of TARGETS.entries()) {
    const at = t.at ?? DESKTOP;
    if (at !== BOTH && at !== viewport) continue;
    checked += 1;
    const want = SPEC[t.spec];
    if (!want) {
      failures.push(`${t.spec}: no such selector in spec.json`);
      continue;
    }
    const actual = captures.map(c => c.targets[index]).find(Boolean);
    if (!actual) {
      failures.push(
        `${t.spec}: nothing matched "${t.find}" in any capture ` +
          `(${captures.length} state${captures.length === 1 ? '' : 's'})`
      );
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
    `design audit passed: ${checked} components match the artboards` +
      `${scheme ? ` (${scheme} scheme` : ' ('}, ${viewport} shell).`
  );
}

main();
