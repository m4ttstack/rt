#!/usr/bin/env node
// Generates the mr-row redesign artboards. Every value is lifted from
// apps/board/src/style.css + packages/tui-kit/src/generated/theme.css
// (Tokyo light/dark), not eyeballed. Edit this file, re-run it, re-seed.
//
// The laws (validated against daily use, 2026-09-11):
//   1. Temperature: hot = my move is the bottleneck; warm = live and
//      moving without me; settled = done/history. Rest shows hot and
//      warm and live workflow marks; settled is summoned (hover, menu).
//   2. Zoom: glance (edge bars) -> rest -> hover (all verbs, context
//      card) -> menu/queue. The queue is the gate seat; the row only
//      points at it. Nothing skips a level.
//   3. The row is a sentence with ONE predicate: identity line, facts
//      line, and a single status line. The hottest fact wins it; "+N
//      active" points at the rest. Rows are a fixed height, always.
//      Peers and nudges are lanes, not chips.
//   4. Color is a verb: amber decide, red repair, purple wait, green
//      read. Workflow marks (slack posted) stay mono. One hue per edge.
//   5. Position is meaning: urgency at the edge, identity line 1,
//      evidence line 2, activity below. A hot line's PRIMARY verb sits
//      on it at rest; secondary verbs wait for hover.
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
  .tight .row { padding: 8px 12px 8px 0; height: 78px; }
  .tight .r2 { margin-top: 2px; }
  .tight .acts { margin-top: 5px; }
  .tight .act { line-height: 18px; }

  /* one content edge: 44px gutter column, then text. */
  .row { display: grid; grid-template-columns: 40px minmax(0,1fr); align-items: start;
         padding: 12px 16px 12px 0; position: relative; height: 92px; box-sizing: border-box;
         overflow: hidden; }
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
  .r2 { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: .76rem;
        line-height: 16px; margin-top: 4px; }
  .iid { color: color-mix(in srgb, var(--fg) 70%, var(--muted)); font-weight: 500; }
  .branch { min-width: 0; max-width: 34ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grow { flex: 1; }
  .adds { color: color-mix(in srgb, var(--green) 70%, var(--muted)); }
  .dels { color: color-mix(in srgb, var(--red) 70%, var(--muted)); }
  .unread { position: relative; top: -4px; margin-left: 2px;
            color: var(--accent); font-size: 9.5px; font-weight: 700; line-height: 1;
            font-variant-numeric: tabular-nums; }
  .mark { display: inline-flex; opacity: .55; }
  .mark.slk { opacity: 1; }
  .mark.ghost { opacity: .22; }
  .pair { white-space: nowrap; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .facts { display: inline-flex; align-items: center; gap: 12px; flex-shrink: 0;
           font-variant-numeric: tabular-nums; }
  .facts .thr { color: var(--accent); text-decoration: none; }
  .facts .thr:hover { text-decoration: underline; }
  .facts .age { text-align: right; font-size: .7rem;
                color: color-mix(in srgb, var(--muted) 75%, transparent); }

  /* the ledger: 20px lines on the shared content edge. */
  .acts { margin-top: 8px; display: flex; flex-direction: column; gap: 2px; }
  .act { display: flex; align-items: baseline; font-size: .76rem; line-height: 20px;
         color: var(--muted); min-width: 0; }
  .act .w { font-weight: 600; }
  .act-work .w, .act-work .ring { color: var(--purple); }
  .act-go .w { color: var(--green); }
  .act-warn .w { color: var(--amber); }
  .act-bad .w { color: var(--red); }
  .act-quiet .w { color: var(--muted); font-weight: 500; }
  .act-clear .w { color: color-mix(in srgb, var(--green) 40%, var(--muted)); font-weight: 500;
                  display: inline-flex; align-items: center; gap: 6px; }
  .act-clear .w svg { opacity: .8; }
  .act .d { margin-left: 10px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more { margin-left: 8px; flex-shrink: 0; color: color-mix(in srgb, var(--muted) 70%, transparent); font-size: .7rem; }
  .act .ring { display: inline-block; width: 9px; height: 9px; border-radius: 50%;
               border: 1.5px solid color-mix(in srgb, currentColor 35%, transparent);
               border-top-color: currentColor; margin-left: 8px; align-self: center;
               animation: rot 1s linear infinite; }
  @keyframes rot { to { transform: rotate(360deg); } }
  @keyframes pulse { 50% { opacity: .25; } }
  .act .do { display: inline-flex; gap: 14px; margin-left: auto; padding-left: 16px; flex-shrink: 0; }
  .act .do a { font-size: .72rem; font-weight: 600; text-decoration: none; color: var(--accent); }
  .act .do a.mut { color: var(--muted); font-weight: 500; }
  .act .do a.sec { display: none; }
  .row.hov .act .do a.sec { display: inline; }
  .row.restless .act .do { display: none; }
  .row.restless.hov .act .do { display: inline-flex; }

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
  .legend { display: flex; gap: 26px; margin: 2px 2px 12px; font-size: .74rem; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
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

const svgIcon = (paths) => `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2.5px">${paths}</svg>`;
const IC = {
  bubble: svgIcon('<path d="M2.5 2.5h11a1.2 1.2 0 0 1 1.2 1.2v6.6a1.2 1.2 0 0 1-1.2 1.2H8.4L5 14.5v-3H2.5a1.2 1.2 0 0 1-1.2-1.2V3.7a1.2 1.2 0 0 1 1.2-1.2z" fill="currentColor" stroke="none"/><circle cx="5.6" cy="7" r="1.05" fill="var(--bg)" stroke="none"/><circle cx="10.4" cy="7" r="1.05" fill="var(--bg)" stroke="none"/>'),
  eye: svgIcon('<ellipse cx="4.6" cy="8" rx="3.1" ry="5.2" fill="currentColor" stroke="none"/><ellipse cx="11.4" cy="8" rx="3.1" ry="5.2" fill="currentColor" stroke="none"/><circle cx="4" cy="9" r="1.4" fill="var(--bg)" stroke="none"/><circle cx="10.8" cy="9" r="1.4" fill="var(--bg)" stroke="none"/>'),
  slack: `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-2.5px" fill="currentColor"><path d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5Z"/><path d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5Z"/><path d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5Z"/><path d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5Z"/></svg>`,
  check: svgIcon('<circle cx="8" cy="8" r="6.6" fill="currentColor" stroke="none"/><path d="M5.1 8.3l1.9 1.9 3.9-4.5" stroke="var(--bg)" stroke-width="1.8"/>'),
  slackColor: `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-2.5px"><path fill="#E01E5A" d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5Z"/><path fill="#36C5F0" d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5Z"/><path fill="#2EB67D" d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5Z"/><path fill="#ECB22E" d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5Z"/></svg>`,
  sun: svgIcon('<circle cx="8" cy="8" r="3.3" fill="currentColor" stroke="none"/><path d="M8 1.2v2.2M8 12.6v2.2M1.2 8h2.2M12.6 8h2.2M3.2 3.2l1.6 1.6M11.2 11.2l1.6 1.6M12.8 3.2l-1.6 1.6M4.8 11.2l-1.6 1.6" stroke-width="1.8"/>'),
};

// ── row scaffolding ─────────────────────────────────────────────────
const SLACK_STAGE = {
  looking: { icon: 'eye', title: 'someone is looking at this' },
  commented: { icon: 'bubble', title: 'commented in slack' },
  approved: { icon: 'check', title: 'approved in slack' },
};
function r1({ title, phrase, phraseColor = 'var(--amber)', slack = null }) {
  const ph = phrase ? `<span class="phrase" style="color:${phraseColor}">${phrase}</span>` : '';
  const st = SLACK_STAGE[slack];
  const stage = st ? `<span class="mark" title="${st.title}">${IC[st.icon]}</span>` : '';
  const logo = slack
    ? `<span class="mark slk" title="posted in slack">${IC.slackColor}</span>`
    : '';
  return `<div class="r1"><span class="title">${title}</span>${stage}${logo}${ph}</div>`;
}

function r2({ iid, branch, adds, dels, threads, age, fresh = 0, slack = false }, extra = '') {
  const freshTag = fresh ? `<span class="unread" title="${fresh} new since you last looked">${fresh}</span>` : '';
  return `<div class="r2">
    <span class="iid">!${iid}</span>
    <span class="branch">${branch}</span>
    <span class="pair"><span class="adds">+${adds}</span> <span class="dels">−${dels}</span></span>
    <span class="grow"></span>
    <span class="facts">${
      threads ? `<a href="#" class="thr" title="open the comments drawer">${threads} thread${threads > 1 ? 's' : ''}${freshTag}</a>` : ''
    }<span class="age">${age}</span></span>
    ${extra}
  </div>`;
}

const act = (tone, word, detail = '', actions = [], spin = false, more = 0) => `
  <div class="act act-${tone}">
    <span class="w">${word}</span>
    ${spin ? '<span class="ring"></span>' : ''}
    ${detail ? `<span class="d">${detail}</span>` : ''}
    ${more ? `<span class="more">+${more} active</span>` : ''}
    ${actions.length ? `<span class="do">${actions.map(([t, mut, sec]) => `<a href="#" class="${[mut ? 'mut' : '', sec ? 'sec' : ''].join(' ').trim()}">${t}</a>`).join('')}</span>` : ''}
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
<h2>the row · final design</h2>
<p class="note">Every row is the same fixed height: identity, evidence, and exactly ONE status
line. The hottest fact wins the line (decide beats interrupted beats running beats ready);
"+N active" marks the rest, revealed by hover or the menu. Decide implies review: a gate line
subsumes its lane's state ("post 2 findings? · review ready"). A hot line carries its primary
verb at rest; secondary verbs and the checkbox wait for hover. The right rail has one meaning
per line: the pill (with the slack posted-mark beside it), then threads · age flush to the
edge with the age as the corner anchor, then the verb. The diff count reads with the branch,
where the code facts live. The status line's right end is
never empty on an active row: the next verb lives there, accent when hot (relaunch, answer),
muted when warm (focus, view).
A quiet row's status line says <b>all clear</b>, softly; the height never changes.</p>

<div class="list">
  ${row(AMBER, 'warn',
    r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR) +
    `<div class="acts">
      ${act('warn', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true, true]])}
    </div>`
  )}
  ${row(AMBER, '',
    r1({ title: MR2.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR2) +
    `<div class="acts">
      ${act('work', 'review running…', 'started 4m ago', [['focus', true]], true)}
    </div>`
  )}
  ${row(GREEN, 'warn',
    r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN }) +
    r2(MR3) +
    `<div class="acts">
      ${act('warn', 'post 2 findings?', '', [['answer']])}
    </div>`
  )}
  ${row(GREEN, '',
    r1({ title: 'CV-3149 Widen the transform contract', phrase: 'APPROVED', phraseColor: GREEN, slack: 'looking' }) +
    r2({ iid: 44684, branch: 'feature/cv-3149', adds: 296, dels: 16, threads: 5, age: '9h', fresh: 2 }) +
    `<div class="acts">
      ${act('work', 'geoff is reviewing…', '', [['view ↗', true]], true)}
    </div>`
  )}
  ${row(GREEN, '',
    r1({ title: 'CV-3114 Carry the standard onto the legacy grid', phrase: 'APPROVED', phraseColor: GREEN, slack: 'approved' }) +
    r2({ iid: 44740, branch: 'feature/cv-3114', adds: 114, dels: 0, threads: 0, age: '6h' }) +
    `<div class="acts">${act('clear', 'all clear', `${IC.sun} enjoy the sunshine`, [['open ↗', true]])}</div>`
  )}
</div>
<p class="cap"><b>Scan path:</b> edge bars, then colored words, then the quiet facts. Row 4 is
your own MR: slack posted-mark at rest, "2 new" since you last looked, a peer live on it.</p>
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
    r1({ title: 'CV-3149 Widen the transform contract', phrase: 'APPROVED', phraseColor: GREEN, slack: 'looking' }) +
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
// RestHover: the same hot row at rest and under the pointer
// ════════════════════════════════════════════════════════════════════
const restHoverBody = `
<h2>rest</h2>
<p class="note">Primary verb only; nothing else asks for the pointer.</p>
<div class="list">
  ${row(AMBER, 'warn',
    r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR) +
    `<div class="acts">
      ${act('warn', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true, true]])}
    </div>`
  )}
</div>

<h2>hover</h2>
<p class="note">Secondary verbs and the checkbox materialize; the accent wash marks the row.</p>
<div class="list">
  ${row(AMBER, 'warn',
    `<span style="position:absolute;left:14px;top:14px"><input type="checkbox" style="accent-color:var(--accent);margin:0"></span>` +
    r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR) +
    `<div class="acts">
      ${act('warn', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true, true]])}
    </div>`,
    true
  )}
</div>
<p class="cap">The dot yields to the checkbox on hover; right-click still opens the full menu.</p>
`;

// ════════════════════════════════════════════════════════════════════
// Density: comfortable (current scale) vs compact
// ════════════════════════════════════════════════════════════════════
const densityBody = `
<h2>comfortable · 12/16 padding, 20px lines</h2>
<div class="list">
  ${row(AMBER, '',
    r1({ title: MR2.title, phrase: 'NEEDS REVIEW' }) + r2(MR2) +
    `<div class="acts">${act('work', 'running…', 'started 4m ago', [], true)}</div>`
  )}
  ${row(GREEN, '',
    r1({ title: 'CV-3149 Widen the transform contract', phrase: 'APPROVED', phraseColor: GREEN, slack: 'looking' }) +
    r2({ iid: 44684, branch: 'feature/cv-3149', adds: 296, dels: 16, threads: 2, age: '9h' }) +
    `<div class="acts">${act('clear', 'all clear', `${IC.sun} enjoy the sunshine`, [])}</div>`
  )}
</div>

<h2>compact · 8/12 padding, 18px lines</h2>
<div class="list tight">
  ${row(AMBER, '',
    r1({ title: MR2.title, phrase: 'NEEDS REVIEW' }) + r2(MR2) +
    `<div class="acts">${act('work', 'running…', 'started 4m ago', [], true)}</div>`
  )}
  ${row(GREEN, '',
    r1({ title: 'CV-3149 Widen the transform contract', phrase: 'APPROVED', phraseColor: GREEN, slack: 'looking' }) +
    r2({ iid: 44684, branch: 'feature/cv-3149', adds: 296, dels: 16, threads: 2, age: '9h' }) +
    `<div class="acts">${act('clear', 'all clear', `${IC.sun} enjoy the sunshine`, [])}</div>`
  )}
</div>
<p class="cap">Same anatomy, two scales; pick by feel.</p>
`;
// ════════════════════════════════════════════════════════════════════
// All states: direction A
// ════════════════════════════════════════════════════════════════════
const L = (tone, word, detail, actions, spin, bar = '', mr = MR, dot = AMBER, phrase = 'NEEDS REVIEW', phraseColor = AMBER) =>
  row(dot, bar,
    r1({ title: mr.title, phrase, phraseColor }) + r2(mr) +
    `<div class="acts">${act(tone, word, detail, actions, spin)}</div>`,
    actions.length > 0);

const lanesBody = `
<h2>review lane · every state</h2>
<div class="list">
  ${L('quiet', 'review queued', '', [], false)}
  ${L('work', 'review running…', 'started 4m ago', [], true)}
  ${L('go', 'review ready', '', [['read ↗']], false)}
  ${L('bad', 'review failed', 'pane closed… cleared from the board', [['launch again']], false, 'bad')}
  ${L('warn', 'interrupted', 'pane closed 12m ago', [['relaunch'], ['clear', true]], false, 'warn')}
</div>

<h2>response lane</h2>
<div class="list">
  ${L('quiet', 'response queued', '', [], false)}
  ${L('work', 'triaging…', '', [], true)}
  ${L('work', 'implementing…', '3 threads', [], true)}
  ${L('work', 'drafting replies…', '', [], true)}
  ${L('go', 'replies posted', '3 of 3', [['read ↗']], false)}
  ${L('warn', '2 of 3 posted', 'one thread waiting', [['resume ↗']], false, 'warn')}
  ${L('warn', 'drafted, not posted', '', [['resume ↗']], false, 'warn')}
  ${L('bad', 'response failed', '', [['restart']], false, 'bad')}
  ${L('warn', 'interrupted', 'pane closed', [['relaunch'], ['clear', true]], false, 'warn')}
</div>

<h2>doctor lane</h2>
<div class="list">
  ${L('quiet', 'doctor queued', '', [], false, '', MR4, RED, 'CI FAILING', RED)}
  ${L('work', 'diagnosing…', 'auto', [], true, '', MR4, RED, 'CI FAILING', RED)}
  ${L('work', 'rebasing…', '', [], true, '', MR4, RED, 'CI FAILING', RED)}
  ${L('work', 'fixing…', '', [], true, '', MR4, RED, 'CI FAILING', RED)}
  ${L('work', 'watching CI…', '', [], true, '', MR4, RED, 'CI FAILING', RED)}
  ${L('go', 'diagnosed', 'held a note', [['read note']], false, '', MR4, RED, 'CI FAILING', RED)}
  ${L('bad', 'doctor stuck', '', [['call again']], false, 'bad', MR4, RED, 'CI FAILING', RED)}
</div>
`;

const attentionBody = `
<h2>decisions &amp; attention · every state</h2>
<p class="note">Gates and executor trouble share the ledger: "decide" for questions waiting on
you, attention tones on whichever lane broke. "answer" always opens the decision queue (the
queue is the gate seat; the row never grows a form). The edge bar matches the row's most
urgent line (red beats amber).</p>
<div class="list">
  ${L('warn', 'post 2 findings?', 'recommended: post', [['answer']], false, 'warn')}
  ${L('warn', 'pane needs attention', 'blocked 3m on a prompt', [['focus'], ['dismiss', true]], false, 'warn')}
  ${L('quiet', 'answered · parked', 'resumes when the pane returns', [], false)}
  ${L('bad', 'answered, no pane to execute', '', [['relaunch'], ['dismiss', true]], false, 'bad')}
  ${L('bad', 'answer stuck', 'delivery failed twice', [['retry'], ['dismiss', true]], false, 'bad')}
  ${L('warn', 'sam asked for a re-review', '30m ago', [['re-review']], false, 'warn')}
  ${L('warn', 'held: verification note', 'doctor draft', [['read'], ['dismiss', true]], false, 'warn')}
  ${L('quiet', 'off-screen', 'pane hidden, still running', [['focus']], false)}
</div>
<p class="cap"><b>Herd note:</b> a herd-owned gate never lands here... only escalated ones
surface, in the same "decide" slot with an <b>escalated</b> detail.</p>
`;

const ambientBody = `
<h2>context · at rest and summoned</h2>
<p class="note">Live context sits quietly on the row: the slack posted-mark and fresh-activity
count in the facts line, a live peer as a warm ledger line. Settled context (reaction detail,
posting history, past nudges) is summoned by hover or the menu. Anything that becomes an ask
for you turns into a hot line.</p>
<div class="list">
  ${row(GREEN, '',
    r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN }) +
    r2({ ...MR3, fresh: 2 }) +
    `<div class="acts">${act('work', 'geoff is reviewing…', '', [], true)}</div>`
  )}
  ${row(GREEN, '',
    r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN }) +
    r2({ ...MR3 }) +
    `<div class="acts">${act('quiet', 'nudged sam', 'no answer yet, 30m', [], false)}</div>`
  )}
</div>
<div class="hover">
  <b>context</b><br>
  ${IC.slack} posted in #mr-reviews · reactions 👀 ✅<br>
  ${IC.eye} geoff opened it 20m ago · alice reviewed yesterday
</div>
<p class="cap">The hover card carries the settled detail; reactions keep their emoji faces
there, never on the row.</p>

<h2>the slack ladder · four stages, one slot</h2>
<p class="note">The mark beside the pill shows the FURTHEST slack stage. One glyph, mono,
hover names it; the full reaction detail lives in the context card.</p>
<div class="legend">
  <span>${IC.slackColor} posted</span>
  <span>${IC.eye} looking</span>
  <span>${IC.bubble} commented</span>
  <span>${IC.check} approved</span>
</div>
<div class="list">
  ${row(GREEN, '', r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN, slack: 'posted' }) + r2(MR3))}
  ${row(GREEN, '', r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN, slack: 'looking' }) + r2(MR3))}
  ${row(GREEN, '', r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN, slack: 'commented' }) + r2(MR3))}
  ${row(GREEN, '', r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN, slack: 'approved' }) + r2(MR3))}
</div>

<h2>live human reviewer</h2>
<div class="list">
  ${row(GREEN, '',
    r1({ title: MR3.title, phrase: 'APPROVED', phraseColor: GREEN }) +
    r2(MR3) +
    `<div class="acts">${act('quiet', 'alice is reviewing right now')}</div>`
  )}
</div>
`;

const stressBody = `
<h2>stress test · everything at once</h2>
<p class="note">The worst real row: a dead review, a response mid-flight, a doctor watching CI,
a decision waiting. One line still: the hottest fact wins, "+3 active" carries the rest to
hover and the menu. The row is the same height as every other row on the board.</p>
<div class="list">
  ${row(AMBER, 'warn',
    r1({ title: MR.title, phrase: 'NEEDS REVIEW' }) +
    r2(MR) +
    `<div class="acts">
      ${act('warn', 'post 2 findings?', 'review interrupted', [['answer']], false, 3)}
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

writeFileSync(join(OUT, 'Main.dc.html'), page('MR Row · the design', mainBody));
writeFileSync(join(OUT, 'RestHover.dc.html'), page('Rest and hover', restHoverBody));
writeFileSync(join(OUT, 'Density.dc.html'), page('Density', densityBody));
writeFileSync(join(OUT, 'DirectionB.dc.html'), page('MR Row · direction B', dirBBody));
writeFileSync(join(OUT, 'DirectionC.dc.html'), page('MR Row · direction C', dirCBody));
writeFileSync(join(OUT, 'StatesLanes.dc.html'), page('Lane states', lanesBody));
writeFileSync(join(OUT, 'StatesAttention.dc.html'), page('Attention states', attentionBody));
writeFileSync(join(OUT, 'StatesAmbient.dc.html'), page('Context off-row', ambientBody));
writeFileSync(join(OUT, 'StatesStress.dc.html'), page('Stress test', stressBody));

const canvas = {
  artboards: [
    { file: 'Main.dc.html', title: 'The design', x: 0, y: 0, w: 780, h: 760 },
    { file: 'RestHover.dc.html', title: 'Rest vs hover', x: 860, y: 0, w: 780, h: 560 },
    { file: 'Density.dc.html', title: 'Density A/B', x: 860, y: 680, w: 780, h: 620 },
    { file: 'DirectionB.dc.html', title: 'Direction B · one phrase + rail', x: 1720, y: 0, w: 780, h: 500 },
    { file: 'DirectionC.dc.html', title: 'Direction C · chip grammar', x: 1720, y: 620, w: 780, h: 500 },
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
        'MR row redesign, from the validated laws:\n' +
        'hot/warm/settled temperatures; zoom levels; the row\n' +
        'is a sentence; color is a verb; position is meaning.\n' +
        'Page 1: the design + rest/hover + density (B and C\n' +
        'kept as rejected directions). Page 2: every state.',
    },
  ],
  pages: [
    { id: 'page-1', name: 'Directions' },
    { id: 'page-2', name: 'All states' },
  ],
  launch: { view: 'canvas', page: 'page-1' },
};
writeFileSync(join(OUT, 'canvas.json'), JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote 9 artboards + canvas.json');
