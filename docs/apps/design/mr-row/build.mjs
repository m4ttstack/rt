#!/usr/bin/env node
// Generates the mr-row redesign artboards. Every value is lifted from
// apps/board/src/style.css + packages/tui-kit/src/generated/theme.css
// (Tokyo light/dark), not eyeballed. Edit this file, re-run it, re-seed.
//
// The design system (direction A, v3):
//   1. One content edge. Title, meta and ledger all start at the same x.
//      The status dot and the attention bar live in the gutter, never
//      shifting the text edge.
//   2. A strict 4px spacing scale. 12/16 row padding, 4 title-to-meta,
//      8 meta-to-ledger, 20px ledger line height.
//   3. Attention is ONE device: a 3px gutter bar (amber = your move,
//      red = something died) plus the colored status word. No washes,
//      no banners, no ticks.
//   4. Actions read inline, as the end of the sentence. Nothing is flung
//      to the far edge of the row.
//   5. Passive context (slack, peers, reactions) is not on the row. It
//      lives in the hover card and the row menu. If it has a verb, it is
//      a ledger line.
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const OUT = dirname(fileURLToPath(import.meta.url));

const CSS = `
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13.5px;
    background: light-dark(#f7f8fa, #16161e);
    color: light-dark(#222, #e3e7f6);
    --bg: light-dark(#f7f8fa, #16161e);
    --card: light-dark(#ffffff, #2c3352);
    --fg: light-dark(#222, #e3e7f6);
    --muted: light-dark(#565d80, #969ec2);
    --border: light-dark(#c8cad6, #3b4261);
    --border-soft: light-dark(#dcdee6, #2c3352);
    --accent: light-dark(#2e7de9, #7aa2f7);
    --green: light-dark(#587539, #9ece6a);
    --red: light-dark(#f52a65, #f7768e);
    --amber: light-dark(#8c6c3e, #e0af68);
    --purple: light-dark(#7847bd, #bb9af7);
    --cyan: light-dark(#007197, #7dcfff);
    padding: 18px 22px;
  }
  a { color: var(--accent); } a:hover { color: var(--accent); }
  h2 { font: 600 12px/1.4 inherit; letter-spacing: .07em; text-transform: uppercase;
       color: var(--purple); margin: 22px 0 8px; }
  h2:first-child { margin-top: 0; }
  p.note { font-size: 11.5px; line-height: 1.55; color: var(--muted); margin: 2px 0 12px; max-width: 74ch; }
  .cap { font-size: 11px; color: var(--muted); margin: 6px 2px 14px; line-height: 1.5; max-width: 74ch; }
  .cap b { color: var(--fg); font-weight: 600; }

  .list { border: 1px solid var(--border-soft); border-radius: 8px; background: var(--bg); overflow: hidden; }

  /* one content edge: 44px gutter column, then text. */
  .row { display: grid; grid-template-columns: 40px minmax(0,1fr); align-items: start;
         padding: 12px 16px 12px 0; position: relative; }
  .row + .row { border-top: 1px solid var(--border-soft); }
  .row.hov { background: color-mix(in srgb, var(--accent) 6%, transparent); }
  .gut { display: flex; align-items: center; justify-content: center; height: 20px; }
  .dot { font-size: 10px; line-height: 1; }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: 0 2px 2px 0; }
  .bar-warn { background: var(--amber); }
  .bar-bad { background: var(--red); }

  .r1 { display: flex; align-items: baseline; gap: 8px; min-width: 0; height: 20px; }
  .title { font-weight: 500; font-size: .85rem; flex: 1; min-width: 0; overflow: hidden;
           text-overflow: ellipsis; white-space: nowrap; }
  .phrase { flex-shrink: 0; display: inline-flex; align-items: center; padding: 1px 6px;
            border: 1px solid currentColor; border-radius: 4px; font-size: .62rem; font-weight: 700;
            text-transform: uppercase; letter-spacing: .04em; }
  .r2 { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: .76rem;
        line-height: 16px; margin-top: 4px; }
  .r2 .sep { opacity: .45; }
  .branch { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grow { flex: 1; }
  .adds { color: color-mix(in srgb, var(--green) 70%, var(--muted)); }
  .dels { color: color-mix(in srgb, var(--red) 70%, var(--muted)); }

  /* the ledger: 20px lines on the shared content edge. */
  .acts { margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
  .act { display: flex; align-items: baseline; font-size: .76rem; line-height: 20px;
         color: var(--muted); min-width: 0; }
  .act .lane { width: 64px; flex-shrink: 0; font-size: .7rem; color: color-mix(in srgb, var(--muted) 75%, transparent); }
  .act .w { font-weight: 600; }
  .act-work .w { color: var(--purple); }
  .act-go .w { color: var(--green); }
  .act-warn .w { color: var(--amber); }
  .act-bad .w { color: var(--red); }
  .act-quiet .w { color: var(--muted); font-weight: 500; }
  .act .d { margin-left: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .act .sep { flex-shrink: 0; }
  .act .spin { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: currentColor;
               margin-left: 8px; align-self: center; animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
  .act .do { display: none; }
  .row.hov .act .do { display: inline-flex; gap: 14px; margin-left: auto; padding-left: 16px; flex-shrink: 0; }
  .act .do a { font-size: .72rem; font-weight: 600; text-decoration: none; color: var(--accent); }
  .act .do a.mut { color: var(--muted); font-weight: 500; }

  /* direction B leftovers */
  .sum { font-size: .76rem; font-weight: 600; flex-shrink: 0; }
  .sum.work { color: var(--purple); } .sum.warn { color: var(--amber); }
  .sum.bad { color: var(--red); } .sum.quiet { color: var(--muted); font-weight: 500; }

  /* direction C chips */
  .chips { margin-top: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border: 1px solid currentColor;
          border-radius: 4px; font-size: 11px; white-space: nowrap; background: transparent; }
  .chip.sub { border-color: var(--border); color: var(--muted); opacity: .7; }
  .chip.ok { color: var(--green); } .chip.warn { color: var(--amber); } .chip.bad { color: var(--red); }
  .chip.purple { color: var(--purple); } .chip.cyan { color: var(--cyan); } .chip.accent { color: var(--accent); }
  .chip .x { opacity: .65; font-weight: 400; }
  .chip.pulse { animation: pulse 1.6s ease-in-out infinite; }

  /* hover card (context off-row) */
  .hover { display: inline-block; margin: 10px 0 4px 44px; padding: 10px 14px; border: 1px solid var(--border);
           border-radius: 8px; background: var(--card); box-shadow: 0 8px 28px rgba(0,0,0,.28);
           font-size: .74rem; color: var(--muted); line-height: 1.9; }
  .hover b { color: var(--fg); font-weight: 600; }
`;

const page = (title, body) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${CSS}</style>
  <title>${title}</title>
</helmet>
${body}
</x-dc>
</body>
</html>
`;

const svgIcon = (paths) => `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1.5px">${paths}</svg>`;
const IC = {
  bubble: svgIcon('<path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5V11.5H2.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"/>'),
  eye: svgIcon('<path d="M1.8 8s2.3-4 6.2-4 6.2 4 6.2 4-2.3 4-6.2 4S1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.8"/>'),
};

// ── row scaffolding ─────────────────────────────────────────────────
function r1({ title, phrase, phraseColor = 'var(--amber)' }) {
  const ph = phrase ? `<span class="phrase" style="color:${phraseColor}">${phrase}</span>` : '';
  return `<div class="r1"><span class="title">${title}</span>${ph}</div>`;
}

function r2({ iid, branch, adds, dels, threads, age }, extra = '') {
  return `<div class="r2">
    <span>!${iid}</span><span class="sep">·</span>
    <span class="branch">${branch}</span>
    <span class="grow"></span>
    <span><span class="adds">+${adds}</span> <span class="dels">−${dels}</span></span>
    ${threads ? `<span class="sep">·</span><span>${threads} thread${threads > 1 ? 's' : ''}</span>` : ''}
    <span class="sep">·</span><span>${age}</span>
    ${extra}
  </div>`;
}

const act = (tone, lane, word, detail = '', actions = [], spin = false) => `
  <div class="act act-${tone}">
    <span class="lane">${lane}</span>
    <span class="w">${word}</span>
    ${spin ? '<span class="spin"></span>' : ''}
    ${detail ? `<span class="sep" style="margin-left:8px;opacity:.45">·</span><span class="d">${detail}</span>` : ''}
    ${actions.length ? `<span class="do">${actions.map(([t, mut]) => `<a href="#" class="${mut ? 'mut' : ''}">${t}</a>`).join('')}</span>` : ''}
  </div>`;

// bar: '' | 'warn' | 'bad'. The row's single attention device, in the gutter.
const row = (dot, bar, inner, hov = false) => `<div class="row${hov ? ' hov' : ''}">
  ${bar ? `<span class="bar bar-${bar}"></span>` : ''}
  <div class="gut"><span class="dot" style="color:${dot}">●</span></div>
  <div style="min-width:0">${inner}</div>
</div>`;

const MR = {
  iid: 44451, branch: 'feature/cv-3074', adds: 1455, dels: 13, threads: 1, age: '32h',
  title: 'CV-3074 Port the CV2 stealth-mode and access-links case c…',
};
const MR2 = { iid: 44720, branch: 'feature/cv-3163', adds: 79, dels: 27, threads: 0, age: '8h', title: 'CV-3163 Let screenshot.cjs capture the auth handshake' };
const MR4 = { iid: 44712, branch: 'feature/cv-3201', adds: 41, dels: 9, threads: 0, age: '3h', title: 'CV-3201 Vendor the report fonts so CI stops flaking' };
const MR3 = { iid: 43946, branch: 'feature/cv-3028', adds: 18, dels: 1253, threads: 7, age: '9d', title: 'CV-3028 Delete unreachable legacy dashboards' };

const AMBER = 'var(--amber)';
const GREEN = 'var(--green)';
const RED = 'var(--red)';

// ════════════════════════════════════════════════════════════════════
// Main: direction A, the leading candidate
// ════════════════════════════════════════════════════════════════════
const mainBody = `
<h2>direction a · activity lines (leading)</h2>
<p class="note">Six rules. One content edge: title, meta and ledger share a left edge; the
status dot has the gutter to itself (the checkbox appears there on hover and in select mode).
A strict spacing scale: 12/16 padding, 4 then 8 between lines, 20px ledger lines. Attention is
one device: a 3px full-height edge bar plus the colored status word. At rest a row shows state
only; verbs appear on hover, right-aligned on their line (the first row is drawn hovered).
Passive context is off the row entirely (hover card, row menu); only things with a verb earn a
ledger line.</p>

<div class="list">
  ${row(AMBER, 'warn',
    r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR) +
    `<div class="acts">
      ${act('warn', 'review', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true]])}
    </div>`,
    true
  )}
  ${row(AMBER, '',
    r1({ title: MR2.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR2) +
    `<div class="acts">
      ${act('work', 'review', 'running…', 'started 4m ago', [], true)}
    </div>`
  )}
  ${row(GREEN, 'warn',
    r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN }) +
    r2(MR3) +
    `<div class="acts">
      ${act('go', 'review', 'ready', '', [['read ↗']])}
      ${act('warn', 'decide', 'post 2 findings?', '', [['answer']])}
    </div>`
  )}
  ${row(GREEN, '',
    r1({ title: 'CV-3149 Widen the transform contract', phrase: 'APPROVED', phraseColor: GREEN }) +
    r2({ iid: 44684, branch: 'feature/cv-3149', adds: 296, dels: 16, threads: 2, age: '9h' })
  )}
</div>
<p class="cap"><b>Scan path:</b> gutter bars first (what needs me), colored words second (what is
happening), everything else stays gray until you ask for it.</p>
`;

// ════════════════════════════════════════════════════════════════════
// DirectionB: urgency rail + one synthesized phrase
// ════════════════════════════════════════════════════════════════════
const dirBBody = `
<h2>direction b · one phrase + urgency rail</h2>
<p class="note">Maximum compression: the board synthesizes ONE status phrase per row, right after
the age in the meta line, and the gutter bar carries urgency alone. Details and actions live in
the row menu and a drawer.</p>

<div class="list">
  ${row(AMBER, 'bad',
    r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR, `<span class="sep">·</span><span class="sum bad">review interrupted</span>`)
  )}
  ${row(AMBER, '',
    r1({ title: MR2.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR2, `<span class="sep">·</span><span class="sum work">reviewing… 4m</span>`)
  )}
  ${row(GREEN, 'warn',
    r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN }) +
    r2(MR3, `<span class="sep">·</span><span class="sum warn">2 findings to post</span>`)
  )}
  ${row(GREEN, '',
    r1({ title: 'CV-3149 Widen the transform contract', phrase: 'APPROVED', phraseColor: GREEN }) +
    r2({ iid: 44684, branch: 'feature/cv-3149', adds: 296, dels: 16, threads: 2, age: '9h' })
  )}
</div>
<p class="cap"><b>Tradeoff:</b> calmest board and scans instantly, but one phrase can hide
concurrent facts and every action costs a click into the menu or drawer.</p>
`;

// ════════════════════════════════════════════════════════════════════
// DirectionC: disciplined chips
// ════════════════════════════════════════════════════════════════════
const dirCBody = `
<h2>direction c · chip grammar (least change)</h2>
<p class="note">Keep chips, impose grammar: at most one chip per lane, fixed order, verbs fold
INTO the chip, attention recolors the lane's own chip, ambient marks leave the row. No second
row of bolted-on banners, ever.</p>

<div class="list">
  ${row(AMBER, '',
    r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR) +
    `<div class="chips"><span class="chip warn">interrupted <span class="x">· relaunch</span></span></div>`
  )}
  ${row(AMBER, '',
    r1({ title: MR2.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR2) +
    `<div class="chips"><span class="chip purple pulse">reviewing…</span></div>`
  )}
  ${row(GREEN, '',
    r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN }) +
    r2(MR3) +
    `<div class="chips">
      <span class="chip ok">review ready <span class="x">↗</span></span>
      <span class="chip warn">post 2 findings? <span class="x">· answer</span></span>
    </div>`
  )}
</div>
<p class="cap"><b>Tradeoff:</b> familiar and cheap to ship, but the grammar is convention, not
structure... the next bolted-on feature can still break it, and chips still wrap on narrow rows.</p>
`;

// ════════════════════════════════════════════════════════════════════
// All states: direction A
// ════════════════════════════════════════════════════════════════════
const L = (tone, lane, word, detail, actions, spin, bar = '', mr = MR, dot = AMBER, phrase = 'NEEDS REVIEW', phraseColor = AMBER) =>
  row(dot, bar,
    r1({ title: mr.title, phrase, phraseColor }) + r2(mr) +
    `<div class="acts">${act(tone, lane, word, detail, actions, spin)}</div>`,
    actions.length > 0);

const lanesBody = `
<h2>review lane · every state</h2>
<div class="list">
  ${L('quiet', 'review', 'queued', '', [], false)}
  ${L('work', 'review', 'running…', 'started 4m ago', [], true)}
  ${L('go', 'review', 'ready', '', [['read ↗']], false)}
  ${L('bad', 'review', 'failed', 'pane closed… cleared from the board', [['launch again']], false, 'bad')}
  ${L('warn', 'review', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true]], false, 'warn')}
</div>

<h2>response lane</h2>
<div class="list">
  ${L('quiet', 'response', 'queued', '', [], false)}
  ${L('work', 'response', 'triaging…', '', [], true)}
  ${L('work', 'response', 'implementing…', '3 threads', [], true)}
  ${L('work', 'response', 'drafting replies…', '', [], true)}
  ${L('go', 'response', 'replies posted', '3 of 3', [['read ↗']], false)}
  ${L('warn', 'response', '2 of 3 posted', 'one thread waiting', [['resume ↗']], false, 'warn')}
  ${L('warn', 'response', 'drafted, not posted', '', [['resume ↗']], false, 'warn')}
  ${L('bad', 'response', 'failed', '', [['restart']], false, 'bad')}
  ${L('warn', 'response', 'interrupted', 'pane closed', [['relaunch'], ['clear', true]], false, 'warn')}
</div>

<h2>doctor lane</h2>
<div class="list">
  ${L('quiet', 'doctor', 'queued', '', [], false, '', MR4, RED, 'CI FAILING', RED)}
  ${L('work', 'doctor', 'diagnosing…', 'auto', [], true, '', MR4, RED, 'CI FAILING', RED)}
  ${L('work', 'doctor', 'rebasing…', '', [], true, '', MR4, RED, 'CI FAILING', RED)}
  ${L('work', 'doctor', 'fixing…', '', [], true, '', MR4, RED, 'CI FAILING', RED)}
  ${L('work', 'doctor', 'watching CI…', '', [], true, '', MR4, RED, 'CI FAILING', RED)}
  ${L('go', 'doctor', 'diagnosed', 'held a note', [['read note']], false, '', MR4, RED, 'CI FAILING', RED)}
  ${L('bad', 'doctor', 'stuck', '', [['call again']], false, 'bad', MR4, RED, 'CI FAILING', RED)}
</div>
`;

const attentionBody = `
<h2>decisions &amp; attention · every state</h2>
<p class="note">Gates and executor trouble share the ledger: "decide" for questions waiting on
you, attention tones on whichever lane broke. The gutter bar always matches the row's most
urgent line (red beats amber).</p>
<div class="list">
  ${L('warn', 'decide', 'post 2 findings?', 'recommended: post', [['answer']], false, 'warn')}
  ${L('warn', 'decide', 'pane needs attention', 'blocked 3m on a prompt', [['focus'], ['dismiss', true]], false, 'warn')}
  ${L('quiet', 'decide', 'answered · parked', 'resumes when the pane returns', [], false)}
  ${L('bad', 'decide', 'answered, no pane to execute', '', [['relaunch'], ['dismiss', true]], false, 'bad')}
  ${L('bad', 'decide', 'answer stuck', 'delivery failed twice', [['retry'], ['dismiss', true]], false, 'bad')}
  ${L('warn', 'nudge', 'sam asked for a re-review', '30m ago', [['re-review']], false, 'warn')}
  ${L('warn', 'note', 'held: verification note', 'doctor draft', [['read'], ['dismiss', true]], false, 'warn')}
  ${L('quiet', 'review', 'off-screen', 'pane hidden, still running', [['focus']], false)}
</div>
<p class="cap"><b>Herd note:</b> a herd-owned gate never lands here... only escalated ones
surface, in the same "decide" slot with an <b>escalated</b> detail.</p>
`;

const ambientBody = `
<h2>context lives off-row</h2>
<p class="note">Slack presence, reactions and peer activity are context, not work: the row shows
none of it. Hovering the meta line (or opening the row menu) reveals the context card. Anything
with a verb (a nudge, a held note) is a ledger line on the attention board instead.</p>
<div class="list">
  ${row(GREEN, '',
    r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN }) +
    r2(MR3)
  )}
</div>
<div class="hover">
  <b>context</b><br>
  ${IC.bubble} posted in #mr-reviews · reactions 👀 ✅<br>
  ${IC.eye} geoff is reviewing this on his board
</div>
<p class="cap">The hover card is where reactions keep their real emoji faces; the row itself
never renders one.</p>

<h2>live human reviewer</h2>
<div class="list">
  ${row(GREEN, '',
    r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN }) +
    r2(MR3) +
    `<div class="acts">${act('quiet', 'live', 'alice is reviewing right now')}</div>`
  )}
</div>
`;

const stressBody = `
<h2>stress test · everything at once</h2>
<p class="note">The worst real row: a dead review, a response mid-flight, a doctor watching CI,
a decision waiting. The ledger grows line by line; the gutter bar stays singular and matches the
most urgent line.</p>
<div class="list">
  ${row(AMBER, 'warn',
    r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR) +
    `<div class="acts">
      ${act('warn', 'review', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true]])}
      ${act('work', 'response', 'implementing…', '3 threads', [], true)}
      ${act('work', 'doctor', 'watching CI…', 'auto', [], true)}
      ${act('warn', 'decide', 'post 2 findings?', '', [['answer']])}
    </div>`,
    true
  )}
</div>

<h2>same row, today</h2>
<p class="note">For contrast: the current design's chips-on-chips rendering of that state.</p>
<div class="list">
  ${row(AMBER, '',
    r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR) +
    `<div class="chips">
      <span class="chip warn">⌕ interrupted</span>
      <span class="chip purple pulse">↩ implementing…</span>
      <span class="chip cyan pulse">👨🏻‍⚕️ auto·watching CI…</span>
      <span class="chip warn">⚑ review · answer</span>
      <span class="chip accent">⇄ geoff: reviewing</span>
      <span class="chip accent">⇄ nudged by sam · 30m</span>
      <span class="chip warn">✉ held: verification note</span>
      <span class="chip sub">▣✓</span><span class="chip sub">👀✅</span>
    </div>
    <div style="margin-top:8px;padding:5px 10px;border:1px solid color-mix(in srgb, var(--red) 45%, transparent);border-radius:6px;background:color-mix(in srgb, var(--red) 7%, transparent);display:flex;align-items:center;gap:8px">
      <span style="color:var(--red);font-size:.76rem;font-weight:500;flex:1">executor gone</span>
      <span class="chip" style="color:var(--amber)">RELAUNCH</span>
      <span class="chip sub">CLEAR</span>
    </div>`
  )}
</div>
`;

writeFileSync(join(OUT, 'Main.dc.html'), page('MR Row · direction A', mainBody));
writeFileSync(join(OUT, 'DirectionB.dc.html'), page('MR Row · direction B', dirBBody));
writeFileSync(join(OUT, 'DirectionC.dc.html'), page('MR Row · direction C', dirCBody));
writeFileSync(join(OUT, 'StatesLanes.dc.html'), page('Lane states', lanesBody));
writeFileSync(join(OUT, 'StatesAttention.dc.html'), page('Attention states', attentionBody));
writeFileSync(join(OUT, 'StatesAmbient.dc.html'), page('Context off-row', ambientBody));
writeFileSync(join(OUT, 'StatesStress.dc.html'), page('Stress test', stressBody));

const canvas = {
  artboards: [
    { file: 'Main.dc.html', title: 'Direction A · activity lines', x: 0, y: 0, w: 780, h: 640 },
    { file: 'DirectionB.dc.html', title: 'Direction B · one phrase + rail', x: 860, y: 0, w: 780, h: 500 },
    { file: 'DirectionC.dc.html', title: 'Direction C · chip grammar', x: 1720, y: 0, w: 780, h: 500 },
    { file: 'StatesLanes.dc.html', title: 'Lanes · every state', x: 0, y: 0, w: 780, h: 2200, page: 'page-2' },
    { file: 'StatesAttention.dc.html', title: 'Decisions & attention', x: 860, y: 0, w: 780, h: 1080, page: 'page-2' },
    { file: 'StatesAmbient.dc.html', title: 'Context off-row', x: 860, y: 1200, w: 780, h: 640, page: 'page-2' },
    { file: 'StatesStress.dc.html', title: 'Stress test vs today', x: 1720, y: 0, w: 780, h: 820, page: 'page-2' },
  ],
  annotations: [
    {
      id: 'brief',
      x: 0,
      y: -170,
      w: 330,
      text:
        'MR row redesign: the row is outgrowing chips-on-chips.\n' +
        'Page 1: three directions on the same rows.\n' +
        'Page 2: every state, drawn in direction A.\n' +
        'Tokens lifted verbatim from tui-kit (Tokyo light/dark).',
    },
  ],
  pages: [
    { id: 'page-1', name: 'Directions' },
    { id: 'page-2', name: 'All states' },
  ],
  launch: { view: 'canvas', page: 'page-1' },
};
writeFileSync(join(OUT, 'canvas.json'), JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote 7 artboards + canvas.json');
