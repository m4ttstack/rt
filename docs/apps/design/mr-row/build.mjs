#!/usr/bin/env node
// Generates the mr-row redesign artboards. Every value is lifted from
// apps/board/src/style.css + packages/tui-kit/src/generated/theme.css
// (Tokyo light/dark), not eyeballed. Edit this file, re-run it, re-seed.
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const OUT = dirname(fileURLToPath(import.meta.url));

// ── tokens (verbatim from theme.css) ────────────────────────────────
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

  .list { border: 1px solid var(--border-soft); border-radius: 8px; background: var(--bg); overflow: hidden; }
  .row { display: grid; grid-template-columns: 1.75rem minmax(0,1fr); column-gap: .5rem;
         padding: .7rem 1rem .75rem 1.4rem; position: relative; }
  .row + .row { border-top: 1px solid var(--border-soft); }
  .pick { align-self: stretch; display: flex; align-items: center; justify-content: center; }
  .pick input { accent-color: var(--accent); }
  .r1 { display: flex; align-items: baseline; gap: .55rem; min-width: 0; }
  .dot { font-size: .78rem; line-height: 1; }
  .title { font-weight: 500; font-size: .85rem; flex: 1; min-width: 0; overflow: hidden;
           text-overflow: ellipsis; white-space: nowrap; }
  .phrase { flex-shrink: 0; display: inline-flex; align-items: center; padding: 1px 6px;
            border: 1px solid currentColor; border-radius: 4px; font-size: .62rem; font-weight: 700;
            text-transform: uppercase; letter-spacing: .04em; }
  .r2 { display: flex; align-items: center; gap: .55rem; color: var(--muted); font-size: .78rem; margin-top: .15rem; }
  .branch { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grow { flex: 1; }
  .adds { color: var(--green); } .dels { color: var(--red); }

  /* direction A: activity lines */
  .acts { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
  .act { display: flex; align-items: center; gap: .5rem; font-size: .78rem; line-height: 1.5;
         padding: 1px 6px 1px 8px; border-left: 2px solid transparent; border-radius: 2px; color: var(--muted); }
  .act .w { font-weight: 600; }
  .act .lane { color: var(--muted); opacity: .8; min-width: 4.2em; }
  .act .spin { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor;
               animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
  .act-work  { border-left-color: color-mix(in srgb, var(--purple) 55%, transparent); }
  .act-work .w { color: var(--purple); }
  .act-go    { border-left-color: color-mix(in srgb, var(--green) 55%, transparent); }
  .act-go .w { color: var(--green); }
  .act-warn  { border-left-color: var(--amber);
               background: color-mix(in srgb, var(--amber) 8%, transparent); }
  .act-warn .w { color: var(--amber); }
  .act-bad   { border-left-color: var(--red);
               background: color-mix(in srgb, var(--red) 8%, transparent); }
  .act-bad .w { color: var(--red); }
  .act-quiet .w { color: var(--muted); font-weight: 500; }
  .act .do { margin-left: auto; display: inline-flex; gap: .9rem; flex-shrink: 0; }
  .act .do a { font-size: .72rem; font-weight: 600; text-decoration: none; color: var(--accent); }
  .act .do a.mut { color: var(--muted); }

  /* ambient cluster (right end of r2) */
  .amb { display: inline-flex; align-items: center; gap: .5rem; flex-shrink: 0; color: var(--muted); }
  .amb .on { color: var(--green); }
  .amb .ask { color: var(--accent); font-weight: 600; }

  /* direction B: rail + synthesized phrase */
  .railrow { position: relative; }
  .rail { position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; border-radius: 2px; }
  .rail-quiet { background: transparent; }
  .rail-work { background: var(--purple); animation: pulse 1.6s ease-in-out infinite; }
  .rail-warn { background: var(--amber); }
  .rail-bad { background: var(--red); }
  .sum { font-size: .78rem; font-weight: 600; flex-shrink: 0; }
  .sum.work { color: var(--purple); } .sum.warn { color: var(--amber); }
  .sum.bad { color: var(--red); } .sum.ok { color: var(--green); } .sum.quiet { color: var(--muted); font-weight: 500; }

  /* direction C: disciplined chips (the kit Chip recipe, verbatim) */
  .chips { margin-top: 5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border: 1px solid currentColor;
          border-radius: 4px; font-size: 11px; white-space: nowrap; background: transparent; }
  .chip.sub { border-color: var(--border); color: var(--muted); opacity: .7; }
  .chip.ok { color: var(--green); } .chip.warn { color: var(--amber); } .chip.bad { color: var(--red); }
  .chip.purple { color: var(--purple); } .chip.cyan { color: var(--cyan); } .chip.accent { color: var(--accent); }
  .chip .x { opacity: .65; font-weight: 400; }
  .chip.pulse { animation: pulse 1.6s ease-in-out infinite; }

  .cap { font-size: 11px; color: var(--muted); margin: 6px 2px 14px; line-height: 1.5; max-width: 74ch; }
  .cap b { color: var(--fg); font-weight: 600; }
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

// ── row scaffolding ─────────────────────────────────────────────────
const AVATAR = `<span style="display:inline-block;width:13px;height:13px;border-radius:4px;background:var(--purple);opacity:.75;flex-shrink:0"></span>`;

function r1({ dots = ['var(--amber)'], title, phrase, phraseColor = 'var(--amber)' }) {
  const dotHtml = dots.map(c => `<span class="dot" style="color:${c}">●</span>`).join('');
  const ph = phrase ? `<span class="phrase" style="color:${phraseColor}">${phrase}</span>` : '';
  return `<div class="r1">${dotHtml}<span class="title">${title}</span>${ph}${AVATAR}</div>`;
}

function r2({ iid, branch, adds, dels, threads, age, amb = '' }) {
  return `<div class="r2">
    <span>!${iid}</span><span style="opacity:.5">|</span>
    <span class="branch">${branch}</span>
    <span class="grow"></span>
    <span><span class="adds">+${adds}</span> <span class="dels">−${dels}</span></span>
    ${threads ? `<span>💬 ${threads}</span>` : ''}
    <span>${age}</span>
    ${amb}
  </div>`;
}

const act = (tone, lane, word, detail = '', actions = [], spin = false) => `
  <div class="act act-${tone}">
    ${spin ? '<span class="spin"></span>' : ''}
    <span class="lane">${lane}</span>
    <span class="w">${word}</span>
    ${detail ? `<span>${detail}</span>` : ''}
    ${actions.length ? `<span class="do">${actions.map(([t, mut]) => `<a href="#" class="${mut ? 'mut' : ''}">${t}</a>`).join('')}</span>` : ''}
  </div>`;

const row = (inner, cls = '') => `<div class="row ${cls}">
  <div class="pick"><input type="checkbox" disabled></div>
  <div style="min-width:0">${inner}</div>
</div>`;

const MR = {
  iid: 44451, branch: 'feature/cv-3074', adds: 1455, dels: 13, threads: 1, age: '32h',
  title: 'CV-3074 Port the CV2 stealth-mode and access-links case c…',
};
const MR2 = { iid: 44720, branch: 'feature/cv-3163', adds: 79, dels: 27, threads: 0, age: '8h', title: 'CV-3163 Let screenshot.cjs capture the auth handshake' };
const MR3 = { iid: 43946, branch: 'feature/cv-3028', adds: 18, dels: 1253, threads: 7, age: '9d', title: 'CV-3028 Delete unreachable legacy dashboards' };

const AMB_FULL = `<span class="amb"><span class="on" title="posted in slack">▣✓</span><span title="reactions">👀✅</span><span class="ask" title="peer reviewing">⇄</span><span title="held draft">✉</span></span>`;

// ════════════════════════════════════════════════════════════════════
// Main — direction A, the leading candidate, on real rows
// ════════════════════════════════════════════════════════════════════
const mainBody = `
<h2>direction a · activity lines (leading)</h2>
<p class="note">The chip pile becomes a short ledger: one slim line per active lane
(review / response / doctor / decision), always in the same slot with the same anatomy —
lane · status word · detail · actions. Attention states tint the line itself (amber = your move,
red = something died); there is no separate banner to bolt on. Ambient social marks (slack,
peer, nudge, draft) shrink into a quiet cluster at the meta line's right end. A quiet row is
just two lines again.</p>

<div class="list">
  ${row(
    r1({ dots: ['var(--amber)'], title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2({ ...MR, amb: AMB_FULL }) +
    `<div class="acts">
      ${act('warn', 'review', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true]])}
    </div>`
  )}
  ${row(
    r1({ dots: ['var(--amber)'], title: MR2.title, phrase: 'NEEDS REVIEW' }) +
    r2({ ...MR2 }) +
    `<div class="acts">
      ${act('work', 'review', 'reviewing…', 'started 4m ago', [], true)}
    </div>`
  )}
  ${row(
    r1({ dots: ['var(--green)'], title: MR3.title, phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ ...MR3 }) +
    `<div class="acts">
      ${act('go', 'review', 'review ready', '', [['read ↗']])}
      ${act('warn', 'decide', 'post 2 findings?', 'review-post gate', [['answer']])}
    </div>`
  )}
  ${row(
    r1({ dots: ['var(--green)'], title: 'CV-3149 Widen the transform contract', phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ iid: 44684, branch: 'feature/cv-3149', adds: 296, dels: 16, threads: 2, age: '9h' })
  )}
</div>
<p class="cap"><b>Reading order:</b> row facts stay two lines; agent activity is a block you can
count on — nothing wraps, nothing competes. New lane kinds get a new line, not a new chip species.</p>
`;

// ════════════════════════════════════════════════════════════════════
// DirectionB — urgency rail + one synthesized phrase
// ════════════════════════════════════════════════════════════════════
const dirBBody = `
<h2>direction b · one phrase + urgency rail</h2>
<p class="note">Maximum compression: the board synthesizes ONE status phrase per row
("review interrupted · relaunch?"), right-aligned in the meta line, and a 3px rail on the row's
left edge carries urgency (red = dead, amber = your move, pulsing purple = working, none = quiet).
Details and actions live in the row menu / an expandable drawer, not on the row.</p>

<div class="list">
  ${row(`<span class="rail rail-bad"></span>` +
    r1({ dots: ['var(--amber)'], title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2({ ...MR, amb: `<span class="sum bad">review interrupted · relaunch?</span>` }), 'railrow')}
  ${row(`<span class="rail rail-work"></span>` +
    r1({ dots: ['var(--amber)'], title: MR2.title, phrase: 'NEEDS REVIEW' }) +
    r2({ ...MR2, amb: `<span class="sum work">reviewing… 4m</span>` }), 'railrow')}
  ${row(`<span class="rail rail-warn"></span>` +
    r1({ dots: ['var(--green)'], title: MR3.title, phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ ...MR3, amb: `<span class="sum warn">2 findings to post · decide</span>` }), 'railrow')}
  ${row(`<span class="rail rail-quiet"></span>` +
    r1({ dots: ['var(--green)'], title: 'CV-3149 Widen the transform contract', phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ iid: 44684, branch: 'feature/cv-3149', adds: 296, dels: 16, threads: 2, age: '9h', amb: `<span class="sum quiet">—</span>` }), 'railrow')}
</div>
<p class="cap"><b>Tradeoff:</b> calmest board by far and scans instantly, but one phrase can hide
concurrent facts (a doctor working while a decision waits) and every action costs a click into
the menu or drawer.</p>
`;

// ════════════════════════════════════════════════════════════════════
// DirectionC — disciplined chips
// ════════════════════════════════════════════════════════════════════
const dirCBody = `
<h2>direction c · chip grammar (least change)</h2>
<p class="note">Keep chips, impose grammar: at most one chip per lane, fixed order
(review · response · doctor · decision), actions fold INTO the chip as a suffix verb, attention
states recolor the lane's own chip instead of adding elements, and ambient marks collapse to the
meta cluster. No second row of bolted-on banners, ever.</p>

<div class="list">
  ${row(
    r1({ dots: ['var(--amber)'], title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2({ ...MR, amb: AMB_FULL }) +
    `<div class="chips">
      <span class="chip warn">⌕ interrupted <span class="x">· relaunch ↻</span></span>
    </div>`
  )}
  ${row(
    r1({ dots: ['var(--amber)'], title: MR2.title, phrase: 'NEEDS REVIEW' }) +
    r2({ ...MR2 }) +
    `<div class="chips"><span class="chip warn pulse">⌕ reviewing…</span></div>`
  )}
  ${row(
    r1({ dots: ['var(--green)'], title: MR3.title, phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ ...MR3 }) +
    `<div class="chips">
      <span class="chip ok">⌕ review ready <span class="x">↗</span></span>
      <span class="chip warn">⚑ post 2 findings? <span class="x">· answer</span></span>
    </div>`
  )}
</div>
<p class="cap"><b>Tradeoff:</b> familiar and cheap to ship, but the grammar is convention, not
structure — the next bolted-on feature can still break it, and chips still wrap on narrow rows.</p>
`;

// ════════════════════════════════════════════════════════════════════
// All states — direction A
// ════════════════════════════════════════════════════════════════════
const lanesBody = `
<h2>review lane · every state</h2>
<div class="list">
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('quiet', 'review', 'queued')}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('work', 'review', 'reviewing…', 'started 4m ago', [], true)}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('go', 'review', 'review ready', '', [['read ↗']])}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('bad', 'review', 'review failed', 'pane closed… cleared from the board', [['launch again']])}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('warn', 'review', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true]])}</div>`)}
</div>

<h2>response lane</h2>
<div class="list">
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('quiet', 'response', 'queued')}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('work', 'response', 'triaging…', '', [], true)}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('work', 'response', 'implementing…', '3 threads', [], true)}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('work', 'response', 'drafting replies…', '', [], true)}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('go', 'response', 'replies posted', '3 of 3', [['read ↗']])}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('warn', 'response', '2 of 3 posted', 'one thread waiting', [['resume ↗']])}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('warn', 'response', 'replies drafted, not posted', '', [['resume ↗']])}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('bad', 'response', 'response failed', '', [['restart']])}</div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">${act('warn', 'response', 'interrupted', 'pane closed', [['relaunch'], ['clear', true]])}</div>`)}
</div>

<h2>doctor lane</h2>
<div class="list">
  ${row(r1({ title: MR2.title, phrase: 'CI FAILING', phraseColor: 'var(--red)' }) + r2(MR2) + `<div class="acts">${act('quiet', 'doctor', 'queued')}</div>`)}
  ${row(r1({ title: MR2.title, phrase: 'CI FAILING', phraseColor: 'var(--red)' }) + r2(MR2) + `<div class="acts">${act('work', 'doctor', 'diagnosing…', 'auto', [], true)}</div>`)}
  ${row(r1({ title: MR2.title, phrase: 'CI FAILING', phraseColor: 'var(--red)' }) + r2(MR2) + `<div class="acts">${act('work', 'doctor', 'rebasing…', '', [], true)}</div>`)}
  ${row(r1({ title: MR2.title, phrase: 'CI FAILING', phraseColor: 'var(--red)' }) + r2(MR2) + `<div class="acts">${act('work', 'doctor', 'fixing…', '', [], true)}</div>`)}
  ${row(r1({ title: MR2.title, phrase: 'CI FAILING', phraseColor: 'var(--red)' }) + r2(MR2) + `<div class="acts">${act('work', 'doctor', 'watching CI…', '', [], true)}</div>`)}
  ${row(r1({ title: MR2.title, phrase: 'CI FAILING', phraseColor: 'var(--red)' }) + r2(MR2) + `<div class="acts">${act('go', 'doctor', 'diagnosed', 'held a note', [['read note']])}</div>`)}
  ${row(r1({ title: MR2.title, phrase: 'CI FAILING', phraseColor: 'var(--red)' }) + r2(MR2) + `<div class="acts">${act('bad', 'doctor', 'doctor stuck', '', [['call again']])}</div>`)}
</div>
`;

const attentionBody = `
<h2>decisions & attention · every state</h2>
<p class="note">Gates and executor trouble share the activity block — the "decide" lane for
questions waiting on you, and attention tinting on whichever lane broke. The red banner is gone;
red is reserved for a line inside the block.</p>
<div class="list">
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">
    ${act('warn', 'decide', 'post 2 findings?', 'review-post gate · recommended: post', [['answer']])}
  </div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">
    ${act('warn', 'decide', 'pane needs attention', 'blocked 3m on a prompt', [['focus'], ['dismiss', true]])}
  </div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">
    ${act('quiet', 'decide', 'answered · parked', 'resumes when the pane returns')}
  </div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">
    ${act('bad', 'decide', 'answered, no pane to execute', '', [['relaunch'], ['dismiss', true]])}
  </div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">
    ${act('bad', 'decide', 'answer stuck', 'delivery failed twice', [['retry'], ['dismiss', true]])}
  </div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">
    ${act('warn', 'review', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true]])}
  </div>`)}
  ${row(r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) + r2(MR) + `<div class="acts">
    ${act('quiet', 'review', 'off-screen', 'pane hidden, still running', [['focus']])}
  </div>`)}
</div>
<p class="cap"><b>Herd note:</b> a herd-owned gate never lands here — only escalated ones
surface, in the same "decide" slot with an <b>escalated</b> detail.</p>
`;

const ambientBody = `
<h2>ambient & social · every state</h2>
<p class="note">Everything that is context, not work-in-flight: quiet marks at the meta line's
right end, one glyph each, monochrome until they matter. Hover names them; the row menu holds
their verbs.</p>
<div class="list">
  ${row(r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ ...MR3, amb: `<span class="amb"><span class="on">▣✓</span></span>` }) +
    `<p class="cap" style="margin:4px 0 0">posted in slack</p>`)}
  ${row(r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ ...MR3, amb: `<span class="amb"><span class="on">▣✓</span><span>👀 ✅</span></span>` }) +
    `<p class="cap" style="margin:4px 0 0">slack reactions on the request message</p>`)}
  ${row(r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ ...MR3, amb: `<span class="amb"><span class="ask">⇄ geoff reviewing</span></span>` }) +
    `<p class="cap" style="margin:4px 0 0">peer board reviewing / commented / approved / reviewed — same slot, intent color</p>`)}
  ${row(r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ ...MR3, amb: `<span class="amb"><span class="ask">⇄ nudged by sam · 30m</span></span>` }) +
    `<p class="cap" style="margin:4px 0 0">inbound nudge (someone waits on you) — the one ambient mark allowed weight</p>`)}
  ${row(r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ ...MR3, amb: `<span class="amb"><span style="color:var(--amber)">✉ held: verification note</span></span>` }) +
    `<p class="cap" style="margin:4px 0 0">doctor-drafted note held for approval — click opens the draft modal</p>`)}
  ${row(r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: 'var(--green)' }) +
    r2({ ...MR3 }) +
    `<div class="acts">${act('quiet', '', '👀 alice is reviewing right now')}</div>`)}
</div>
`;

const stressBody = `
<h2>stress test · everything at once</h2>
<p class="note">The worst real row: a review that died, a response mid-flight, a doctor watching
CI, a decision waiting, every ambient mark lit. Direction A holds shape — the block grows line by
line and stays scannable; nothing wraps unpredictably.</p>
<div class="list">
  ${row(
    r1({ dots: ['var(--amber)', 'var(--red)'], title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2({ ...MR, amb: AMB_FULL }) +
    `<div class="acts">
      ${act('warn', 'review', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true]])}
      ${act('work', 'response', 'implementing…', '3 threads', [], true)}
      ${act('work', 'doctor', 'watching CI…', 'auto', [], true)}
      ${act('warn', 'decide', 'post 2 findings?', 'review-post gate', [['answer']])}
    </div>`
  )}
</div>

<h2>same row, today</h2>
<p class="note">For contrast: the current design's chips-on-chips rendering of that state.</p>
<div class="list">
  ${row(
    r1({ dots: ['var(--amber)', 'var(--red)'], title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2({ ...MR }) +
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
    <div style="margin-top:.35rem;padding:.3rem .6rem;border:1px solid color-mix(in srgb, var(--red) 45%, transparent);border-radius:6px;background:color-mix(in srgb, var(--red) 7%, transparent);display:flex;align-items:center;gap:.5rem">
      <span style="color:var(--red);font-size:.78rem;font-weight:500;flex:1">executor gone</span>
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
writeFileSync(join(OUT, 'StatesAmbient.dc.html'), page('Ambient states', ambientBody));
writeFileSync(join(OUT, 'StatesStress.dc.html'), page('Stress test', stressBody));

const canvas = {
  artboards: [
    { file: 'Main.dc.html', title: 'Direction A · activity lines', x: 0, y: 0, w: 780, h: 560 },
    { file: 'DirectionB.dc.html', title: 'Direction B · one phrase + rail', x: 860, y: 0, w: 780, h: 480 },
    { file: 'DirectionC.dc.html', title: 'Direction C · chip grammar', x: 1720, y: 0, w: 780, h: 470 },
    { file: 'StatesLanes.dc.html', title: 'Lanes · every state', x: 0, y: 0, w: 780, h: 1560, page: 'page-2' },
    { file: 'StatesAttention.dc.html', title: 'Decisions & attention', x: 860, y: 0, w: 780, h: 800, page: 'page-2' },
    { file: 'StatesAmbient.dc.html', title: 'Ambient & social', x: 860, y: 920, w: 780, h: 760, page: 'page-2' },
    { file: 'StatesStress.dc.html', title: 'Stress test vs today', x: 1720, y: 0, w: 780, h: 760, page: 'page-2' },
  ],
  annotations: [
    {
      id: 'brief',
      x: 0,
      y: -170,
      w: 330,
      text:
        'MR row redesign — the row is outgrowing chips-on-chips.\n' +
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
