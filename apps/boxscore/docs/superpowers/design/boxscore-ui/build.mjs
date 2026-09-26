// Generates the boxscore UI artboards for the app-kit design pass.
// Every value is lifted from app-kit's Tokyo theme, console's chrome ladder,
// and the kit's shell components; see the spec's section 8 for the target.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// --- Tokyo palettes (packages/tokyo/src/tokyo-theme.css), verbatim ---
const DAY = {
  bg: "#e1e2e7", panel: "#eff0f5", card: "#f6f6fa", border: "#c8cad6", borderSoft: "#d5d7e2",
  fg: "#111111", muted: "#8990b3", mutedText: "#565d80", accent: "#2e7de9", accentText: "#1c5fbf",
  green: "#587539", red: "#f52a65", amber: "#8c6c3e", purple: "#7847bd", cyan: "#007197",
  grid: "rgba(52, 59, 88, 0.05)", dotOk: "#1f9d3a", dotWarn: "#e08a00", dotBad: "#e5153f", wash: "10%",
  onAccent: "#ffffff",
};
const NIGHT = {
  bg: "#16161e", panel: "#232a47", card: "#2c3352", border: "#3b4261", borderSoft: "#313853",
  fg: "#e3e7f6", muted: "#7e86ad", mutedText: "#969ec2", accent: "#7aa2f7", accentText: "#7aa2f7",
  green: "#9ece6a", red: "#f7768e", amber: "#e0af68", purple: "#bb9af7", cyan: "#7dcfff",
  grid: "rgba(122, 162, 247, 0.06)", dotOk: "#4ade5b", dotWarn: "#ffbb3d", dotBad: "#ff5c72", wash: "15%",
  onAccent: "#16161e",
};
const VARS = Object.keys(DAY);
const cssVarName = (k) => "--tk-" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
const rootVars = VARS.map((k) => `${cssVarName(k)}: {{c.${k}}}`).join("; ");

// --- Icons: lucide paths, stroke 2, 24 grid ---
const ICON = {
  panelLeftOpen: '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M9 3v18"></path><path d="m14 9 3 3-3 3"></path>',
  table: '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"></path>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path>',
  arrowLeft: '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
  x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
  chevronDown: '<path d="m6 9 6 6 6-6"></path>',
  external: '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
  check: '<path d="M20 6 9 17l-5-5"></path>',
  plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><path d="m2 2 20 20"></path>',
};
const icon = (name, size = 20, color = "currentColor") =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; flex: none">${ICON[name]}</svg>`;

const BOXSCORE_MARK = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="display: block; flex: none"><rect width="32" height="32" rx="7.2" fill="#ff84ad"></rect><g fill="#1d1830"><rect x="9.4" y="16" width="3.6" height="7" rx="1"></rect><rect x="14.2" y="12" width="3.6" height="11" rx="1"></rect><rect x="19" y="9" width="3.6" height="14" rx="1"></rect></g></svg>`;
const MATTSTACK_MARK = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="display: block; flex: none"><rect width="64" height="64" rx="14.4" fill="#161224"></rect><text x="13" y="40.5" font-family="'JetBrains Mono', ui-monospace, Menlo, monospace" font-size="25.6" font-weight="500" fill="#FF6B9D">m</text><g transform="translate(31.6 22.4) scale(0.8)" fill="none" stroke="#FF6B9D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 L21.8 7 L12 11.5 L2.2 7 Z"></path><path d="M2.2 12.3 L12 16.8 L21.8 12.3"></path><path d="M2.2 17.3 L12 21.8 L21.8 17.3"></path></g></svg>`;

const tri = (up, color) =>
  `<svg width="8" height="8" viewBox="0 0 8 8" style="display: inline-block; vertical-align: middle; margin-right: 3px"><path d="${up ? "M4 1 7 7H1Z" : "M4 7 1 1h6Z"}" fill="${color}"></path></svg>`;

// --- Shared style block (helmet) ---
const STYLE = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
    body { margin: 0; }
    a { color: var(--tk-accent-text); text-decoration: none; }
    a:hover { color: var(--tk-accent-text); text-decoration: underline; }
    .frame { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13.5px; line-height: 1.55; color: var(--tk-fg); background: var(--tk-bg); }
    .content { background-color: var(--tk-bg); background-image: linear-gradient(var(--tk-grid) 1px, transparent 1px), linear-gradient(90deg, var(--tk-grid) 1px, transparent 1px); background-size: 28px 28px; }
    .num { font-variant-numeric: tabular-nums; }
    .th { font-size: 11.2px; font-weight: 600; color: var(--tk-muted-text); text-align: right; padding: 4.8px 7.2px; white-space: normal; line-height: 1.2; vertical-align: bottom; border-bottom: 1px solid var(--tk-border-soft); }
    .td { font-size: 12.16px; text-align: right; padding: 4.8px 7.2px; white-space: nowrap; border-bottom: 1px solid var(--tk-border-soft); }
    .tr-you .td { background: color-mix(in srgb, var(--tk-accent) var(--tk-wash), transparent); }
    .group-l { border-left: 1px solid var(--tk-border); }
    .rail-entry { width: 34px; height: 34px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--tk-fg); }
    .rail-entry-active { background: var(--tk-accent); color: var(--tk-on-accent); }
    .badge { display: inline-flex; align-items: center; height: 16px; padding: 0 6px; border-radius: 10px; font-size: 10.56px; font-weight: 600; letter-spacing: 0.02em; }
    .badge-accent { background: color-mix(in srgb, var(--tk-accent) 15%, transparent); color: var(--tk-accent-text); }
    .badge-muted { background: color-mix(in srgb, var(--tk-fg) 8%, var(--tk-card)); color: var(--tk-muted-text); }
    .btn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 14px; border-radius: 6px; font-size: 11.2px; font-weight: 600; border: 1px solid var(--tk-border); background: var(--tk-panel); color: var(--tk-fg); white-space: nowrap; }
    .btn-filled { background: var(--tk-accent); border-color: var(--tk-accent); color: var(--tk-on-accent); }
    .btn-subtle { border-color: transparent; background: transparent; color: var(--tk-muted-text); }
    .seg { display: inline-flex; padding: 2px; border-radius: 6px; background: var(--tk-panel); border: 1px solid var(--tk-border-soft); height: 28px; box-sizing: border-box; }
    .seg-item { display: inline-flex; align-items: center; padding: 0 10px; border-radius: 4px; font-size: 11.2px; font-weight: 500; color: var(--tk-muted-text); }
    .seg-on { background: var(--tk-card); color: var(--tk-fg); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
    .paper { background: var(--tk-card); border: 1px solid var(--tk-border); border-radius: 6px; }
    .alert-warn { display: flex; gap: 9.6px; align-items: flex-start; padding: 9.6px; border-radius: 6px; background: color-mix(in srgb, var(--tk-amber) 14%, transparent); color: var(--tk-fg); font-size: 11.2px; }
    .kbd { font-size: 10.56px; color: var(--tk-muted-text); }
    .stat-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 5px 9.6px; font-size: 12.16px; border-bottom: 1px solid var(--tk-border-soft); }
    .stat-on { background: color-mix(in srgb, var(--tk-accent) var(--tk-wash), transparent); color: var(--tk-accent-text); }
    .ev-th { font-size: 10.56px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tk-muted-text); text-align: left; padding: 6px 9.6px; border-bottom: 1px solid var(--tk-border-soft); white-space: nowrap; }
    .ev-td { font-size: 12.16px; padding: 5px 9.6px; border-bottom: 1px solid var(--tk-border-soft); vertical-align: top; color: var(--tk-muted-text); }
    .ev-td-key { color: var(--tk-fg); white-space: nowrap; }
    .ev-td-num { text-align: right; white-space: nowrap; }
    .setting-row { display: grid; grid-template-columns: 260px minmax(0, 1fr) 150px 34px; gap: 12px; align-items: start; padding: 9.6px 12px; border-bottom: 1px solid var(--tk-border-soft); }
    .scope { display: inline-flex; align-items: center; gap: 5px; font-size: 10.56px; color: var(--tk-muted-text); white-space: nowrap; }
    .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
    .switch { width: 32px; height: 20px; border-radius: 10px; position: relative; display: inline-block; box-sizing: border-box; }
    .switch-off { background: var(--tk-panel); border: 1px solid var(--tk-border); }
    .switch-on { background: var(--tk-accent); }
    .thumb { width: 14px; height: 14px; border-radius: 50%; background: #ffffff; position: absolute; top: 2px; }
`;

// --- Data (sample values; roster is the live acme-web roster plus boxscore's two extras) ---
const GROUPS = [
  { key: "delivery", label: "Delivery", hint: "Linear", color: "green" },
  { key: "volume", label: "Volume", hint: "gameable", color: "mutedText" },
  { key: "quality", label: "Quality & consistency", hint: null, color: "accentText" },
];
const COLS = [
  { key: "issuesCompleted", label: "Issues done", group: "delivery", better: "desc" },
  { key: "additions", label: "Added", group: "volume", better: "desc" },
  { key: "deletions", label: "Deleted", group: "volume", better: "desc" },
  { key: "mrsMerged", label: "MRs merged", group: "volume", better: "desc" },
  { key: "mrsReviewed", label: "MRs reviewed", group: "volume", better: "desc" },
  { key: "pipelines", label: "Pipelines", group: "volume", better: "desc" },
  { key: "reviewDepth", label: "Review depth", group: "quality", better: "desc" },
  { key: "reviewLatencyHours", label: "Wait for review", group: "quality", better: "asc" },
  { key: "responseLatencyHours", label: "Response time", group: "quality", better: "asc" },
  { key: "revertRate", label: "Revert rate", group: "quality", better: "asc" },
  { key: "sizeHealthPct", label: "Size health", group: "quality", better: "desc" },
  { key: "codingDays", label: "Coding days", group: "quality", better: "desc" },
  { key: "longestStreak", label: "Merge streak", group: "quality", better: "desc" },
  { key: "reciprocity", label: "Reciprocity", group: "quality", better: "desc" },
];
const PEOPLE = [
  { name: "Alex Rivera", user: "alexrivera", you: true, v: ["9", "4,812", "2,106", "14", "11", "88", "2.4/MR", "3.1h", "1.9h", "0%", "71%", "19", "4", "1.2"], r: [1, 2, 2, 1, 2, 2, 2, 2, 2, 1, 4, 1, 2, 3], d: ["+2", "+640", "-212", "+3", "+1", "+9", "+0.3", "-1.4", "+0.2", "0", "+6", "+2", "+1", "+0.1"] },
  { name: "Owen Marsh", user: "owen-at-acme", v: ["8", "6,105", "3,988", "12", "6", "97", "1.1/MR", "2.7h", "6.8h", "8%", "50%", "18", "5", "0.6"], d: ["+3", "+1,930", "+1,204", "+4", "-2", "+21", "-0.2", "-0.6", "+2.1", "+8", "-11", "+1", "+2", "-0.2"] },
  { name: "Nadia Fenwick", user: "nadia1", v: ["7", "3,340", "1,522", "11", "16", "74", "3.1/MR", "5.8h", "1.2h", "9%", "64%", "17", "3", "1.6"], d: ["+1", "-410", "+88", "-1", "+4", "+2", "+0.6", "+0.9", "-0.4", "+9", "-5", "0", "0", "+0.3"] },
  { name: "Sam Kestrel", user: "samkestrel", v: ["6", "2,918", "905", "9", "8", "61", "1.7/MR", "6.4h", "4.3h", "0%", "78%", "15", "3", "0.9"], d: ["0", "+120", "-60", "0", "+1", "-4", "+0.1", "+1.1", "-0.8", "0", "+3", "-1", "0", "+0.1"] },
  { name: "Marco Villanueva", user: "marcovillanueva", v: ["5", "1,764", "640", "7", "9", "52", "2.0/MR", "8.9h", "2.6h", "0%", "86%", "14", "2", "1.3"], d: ["+1", "+300", "+95", "+1", "+2", "+6", "+0.4", "-2.0", "-0.5", "0", "+4", "+1", "0", "+0.2"] },
  { name: "Reggie Voss", user: "nightowl2", v: ["4", "2,230", "1,110", "6", "5", "40", "1.4/MR", "12.2h", "5.1h", "17%", "67%", "12", "2", "0.8"], d: ["-1", "-880", "-402", "-2", "-1", "-12", "-0.5", "+3.4", "+1.2", "+17", "-8", "-3", "-1", "-0.3"] },
  { name: "Miles Chandler", user: "MilesChandler-Acme", v: ["3", "1,102", "388", "5", "4", "33", "0.9/MR", "10.5h", "7.4h", "0%", "80%", "11", "2", "1.0"], d: ["+1", "+410", "+120", "+2", "+1", "+8", "+0.2", "-1.1", "-0.9", "0", "+5", "+2", "+1", "+0.2"] },
];

// --- Chrome ---
function railEntry(name, active, label) {
  return `<div class="rail-entry${active ? " rail-entry-active" : ""}" title="${label}" style="margin-left: 9px">${icon(name, 20)}</div>`;
}
function shell({ title, content, activeRail, height, wide = false }) {
  return `<div class="frame" style="${rootVars}; width: 1440px; height: ${height}px; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box">
  <div style="height: 48px; flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 9.6px; border-bottom: 1px solid var(--tk-border); background: var(--tk-bg); box-sizing: border-box">
    <div style="display: flex; align-items: center; gap: 7.2px">
      ${BOXSCORE_MARK(30)}
      <div style="font-weight: 700; font-size: 22px; line-height: 1; white-space: nowrap">boxscore</div>
    </div>
    <div style="width: 44px; height: 44px; border-radius: 6px; display: flex; align-items: center; justify-content: center" title="Apps">${MATTSTACK_MARK(34)}</div>
  </div>
  <div style="flex: 1; display: flex; min-height: 0">
    <div style="width: 68px; flex: none; border-right: 1px solid var(--tk-border); background: var(--tk-bg); display: flex; flex-direction: column; gap: 4.8px; padding: 9.6px 8px; box-sizing: border-box">
      <div class="rail-entry" style="margin-left: 9px; color: var(--tk-muted-text)">${icon("panelLeftOpen", 20)}</div>
      ${railEntry("table", activeRail === "leaderboard", "Leaderboard")}
      ${railEntry("settings", activeRail === "settings", "Settings")}
      <div style="flex: 1"></div>
      <div class="rail-entry" style="margin-left: 9px; color: var(--tk-fg)">${icon("moon", 20)}</div>
    </div>
    <div style="flex: 1; display: flex; flex-direction: column; min-width: 0">
      <div style="height: 40px; flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; background: var(--tk-panel); border-bottom: 1px solid var(--tk-border); box-sizing: border-box">
        ${title}
      </div>
      <div class="content" style="flex: 1; overflow: hidden; padding: 18px; box-sizing: border-box; display: flex; flex-direction: column; gap: 14.4px; min-height: 0">
        ${content}
      </div>
    </div>
  </div>
</div>`;
}

// --- Leaderboard pieces ---
function controls({ trend, view, refreshing }) {
  const seg = (items, on) => `<div class="seg">${items.map((i) => `<div class="seg-item${i === on ? " seg-on" : ""}">${i}</div>`).join("")}</div>`;
  return `<div style="display: flex; align-items: center; gap: 14.4px; flex-wrap: nowrap">
    ${seg(["7d", "30d", "90d", "Custom"], "30d")}
    <div style="display: flex; align-items: center; gap: 7.2px">
      <div class="switch ${trend ? "switch-on" : "switch-off"}"><div class="thumb" style="${trend ? "right: 2px" : "left: 2px"}"></div></div>
      <div style="font-size: 11.2px; color: var(--tk-muted-text)">Trend vs prior</div>
    </div>
    ${seg(["Table", "Cards"], view)}
    <div style="flex: 1"></div>
    <div class="btn"${refreshing ? ' style="opacity: 0.55"' : ""}>${icon("refresh", 14)}Refresh</div>
  </div>
  <div style="display: flex; gap: 14.4px; font-size: 10.56px; color: var(--tk-muted-text); margin-top: -7.2px">
    <div>Scope: <span style="color: var(--tk-fg)">acme/acme-web</span></div>
    <div>Window: <span style="color: var(--tk-fg)">2026-08-03 → 2026-09-02</span></div>
    <div>${refreshing ? "refreshing" : "cached 14 min ago"}</div>
    ${trend ? `<div style="color: var(--tk-accent-text)">trend vs 2026-07-04+</div>` : ""}
  </div>`;
}

function progressStrip() {
  return `<div class="paper" style="display: flex; align-items: center; gap: 12px; padding: 7.2px 12px">
    <div style="font-size: 12.16px; font-weight: 600; white-space: nowrap">Refreshing · Fetching MR details (312 cached, 41 new)</div>
    <div style="font-size: 10.56px; color: var(--tk-muted-text); white-space: nowrap">trend window (2 of 2)</div>
    <div style="flex: 1; height: 6px; border-radius: 3px; background: var(--tk-panel); overflow: hidden"><div style="width: 58%; height: 100%; background: var(--tk-accent); border-radius: 3px"></div></div>
    <div class="num" style="font-size: 10.56px; color: var(--tk-muted-text)">24/41</div>
    <div class="btn" style="height: 26px; padding: 0 9.6px; font-size: 10.56px">Cancel</div>
  </div>`;
}

function warnings() {
  return `<div class="alert-warn">${icon("warning", 14, "var(--tk-amber)")}<div>Detail fetch failed for 2/41 MRs (e.g. 502 Bad Gateway); those count with zeroed diff/notes.</div></div>`;
}

function deltaCell(d, col) {
  if (d === "0") return `<span style="color: var(--tk-muted-text)">→ 0</span>`;
  const up = !d.startsWith("-");
  const good = col.better === "desc" ? up : !up;
  const color = good ? "var(--tk-green)" : "var(--tk-red)";
  return `<span style="color: ${color}">${tri(up, color)}${d.replace(/^[+-]/, "")}</span>`;
}

function leaderboardTable({ trend, sortKey = "mrsMerged" }) {
  const groupHeads = GROUPS.map((g) => {
    const n = COLS.filter((c) => c.group === g.key).length;
    return `<th class="th group-l" colspan="${n}" style="text-align: left; color: var(--tk-${g.color === "mutedText" ? "muted-text" : g.color === "accentText" ? "accent-text" : g.color}); font-size: 10.56px; letter-spacing: 0.06em; text-transform: uppercase; padding-top: 7.2px">${g.label}${g.hint ? ` <span style="font-weight: 400; color: var(--tk-muted); text-transform: none; letter-spacing: 0">(${g.hint})</span>` : ""}</th>`;
  }).join("");
  const colHeads = COLS.map((c, i) => {
    const gl = i > 0 && COLS[i - 1].group !== c.group ? " group-l" : "";
    const on = c.key === sortKey;
    return `<th class="th${gl}" style="${on ? "color: var(--tk-fg)" : ""}">${c.label}${on ? " ↓" : ""}</th>`;
  }).join("");
  const rows = PEOPLE.map((p) => {
    const cells = p.v.map((v, i) => {
      const col = COLS[i];
      const gl = i > 0 && COLS[i - 1].group !== col.group ? " group-l" : "";
      const chip = p.you ? `<span class="badge badge-accent" style="margin-left: 6px; height: 14px; padding: 0 4px; font-size: 9.5px">#${p.r[i]}</span>` : "";
      const inner = trend
        ? `<span>${v}</span><span style="margin-left: 6px; font-size: 10.56px">${deltaCell(p.d[i], col)}</span>${chip}`
        : `<span>${v}</span>${chip}`;
      return `<td class="td num${gl}">${inner}</td>`;
    }).join("");
    return `<tr class="${p.you ? "tr-you" : ""}">
      <td class="td" style="text-align: left; position: sticky; left: 0; background: ${p.you ? "color-mix(in srgb, var(--tk-accent) var(--tk-wash), var(--tk-card))" : "var(--tk-card)"}">
        <div style="display: flex; flex-direction: column; line-height: 1.3"><span style="${p.you ? "font-weight: 600; color: var(--tk-accent-text)" : "color: var(--tk-fg)"}">${p.name}</span><span style="font-size: 10.56px; color: var(--tk-muted-text)">@${p.user}</span></div>
      </td>${cells}</tr>`;
  }).join("");
  return `<div class="paper" style="overflow: hidden">
    <table style="border-collapse: collapse; width: 100%">
      <thead style="background: color-mix(in srgb, var(--tk-accent) 6%, var(--tk-card))">
        <tr><th class="th" style="text-align: left; padding-top: 7.2px; font-size: 10.56px; letter-spacing: 0.06em; text-transform: uppercase">Person</th>${groupHeads}</tr>
        <tr><th class="th" style="text-align: left">Name</th>${colHeads}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="font-size: 10.56px; color: var(--tk-muted-text); display: flex; gap: 14.4px">
    <div><span style="color: var(--tk-fg)">mrsReviewed:</span> approvals unavailable on this tier; counted from review notes only.</div>
  </div>`;
}

function leaderboardTitle() {
  return `<div style="font-size: 13.6px; font-weight: 600">Leaderboard</div>
  <div style="font-size: 10.56px; color: var(--tk-muted-text)">Volume metrics are gameable; weigh them against the quality columns.</div>`;
}

// --- Cards ---
function cards() {
  const card = (col, i) => {
    const ranked = [...PEOPLE].sort((a, b) => {
      const num = (s) => parseFloat(s.replace(/[^0-9.]/g, ""));
      return col.better === "desc" ? num(b.v[i]) - num(a.v[i]) : num(a.v[i]) - num(b.v[i]);
    });
    const g = GROUPS.find((g) => g.key === col.group);
    const gcolor = g.color === "mutedText" ? "var(--tk-muted-text)" : g.color === "accentText" ? "var(--tk-accent-text)" : "var(--tk-green)";
    const rows = ranked.map((p, rank) => `<div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 4px; border-radius: 4px; font-size: 12.16px${p.you ? "; color: var(--tk-accent-text); font-weight: 600" : ""}">
        <div style="display: flex; gap: 8px; align-items: baseline"><span class="num" style="width: 14px; text-align: right; font-size: 10.56px; color: var(--tk-muted-text); font-weight: 400">${rank + 1}</span><span>${p.name}</span></div>
        <div class="num" style="display: flex; gap: 8px; align-items: baseline; font-weight: 400"><span style="${p.you ? "color: var(--tk-accent-text)" : ""}">${p.v[i]}</span><span style="font-size: 10.56px">${deltaCell(p.d[i], col)}</span></div>
      </div>`).join("");
    return `<div class="paper" style="padding: 12px 12px 9.6px">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 7.2px">
        <div style="font-size: 12.16px; font-weight: 600">${col.label}</div>
        <div style="font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; color: ${gcolor}">${col.group}</div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 1px">${rows}</div>
    </div>`;
  };
  return `<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14.4px">${COLS.map(card).join("")}</div>`;
}

// --- Detail ---
function detail() {
  const me = PEOPLE[0];
  const selected = "mrsMerged";
  const rail = GROUPS.map((g) => {
    const cols = COLS.map((c, i) => ({ ...c, i })).filter((c) => c.group === g.key);
    const gcolor = g.color === "mutedText" ? "var(--tk-muted-text)" : g.color === "accentText" ? "var(--tk-accent-text)" : "var(--tk-green)";
    return `<div>
      <div style="font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; color: ${gcolor}; margin-bottom: 4.8px">${g.label}${g.hint ? ` (${g.hint})` : ""}</div>
      <div class="paper" style="overflow: hidden">${cols.map((c) => `<div class="stat-row${c.key === selected ? " stat-on" : ""}"><span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${c.label}</span><span class="num" style="flex: none">${me.v[c.i]}<span style="margin-left: 5px; font-size: 10.56px; color: var(--tk-muted-text)">#${me.r[c.i]}</span></span></div>`).join("")}</div>
    </div>`;
  }).join("");
  const evRows = [
    ["!1042", "ACME-410: extract cart line-item summary sections under Checkout", "+212", "−48", "2026-08-29"],
    ["!1038", "ACME-402: gate promo-code chips on a shared source", "+96", "−131", "2026-08-27"],
    ["!1035", "ACME-398: multi-strategy select for JSON discount operations", "+338", "−72", "2026-08-25"],
    ["!1033", "ACME-398: isValidDiscountOperationValue helper + tests", "+64", "−9", "2026-08-22"],
    ["!1029", "ACME-388: shipping section layout parity with the legacy renderer", "+410", "−286", "2026-08-20"],
    ["!1026", "ACME-381: island route registration for Order Details", "+151", "−40", "2026-08-18"],
    ["!1021", "ACME-376: remove dead codeowner section resolver", "+3", "−212", "2026-08-14"],
    ["!1017", "ACME-370: fulfillment island reads the returns Q&A source", "+276", "−118", "2026-08-12"],
    ["!1013", "ACME-364: sticky summary strip on order review checkout", "+189", "−54", "2026-08-08"],
    ["!1009", "ACME-358: dedupe workflow states by name in the ticket picker", "+22", "−31", "2026-08-07"],
    ["!1005", "ACME-352: island loader reads the classification map once", "+87", "−140", "2026-08-06"],
    ["!1001", "ACME-347: shipping-damage chip copy and tooltip parity", "+41", "−18", "2026-08-05"],
    ["!997", "ACME-341: fulfillment timeline collapses system notes", "+133", "−62", "2026-08-04"],
    ["!993", "ACME-336: remove legacy shipping section resolver", "+9", "−241", "2026-08-03"],
  ];
  const ev = `<div class="paper" style="overflow: hidden">
    <table style="border-collapse: collapse; width: 100%">
      <thead><tr><th class="ev-th">MR</th><th class="ev-th" style="width: 100%">Title</th><th class="ev-th" style="text-align: right">+</th><th class="ev-th" style="text-align: right">−</th><th class="ev-th">Merged</th></tr></thead>
      <tbody>${evRows.map((r) => `<tr><td class="ev-td ev-td-key"><a href="#">${r[0]}</a></td><td class="ev-td" style="white-space: normal">${r[1]}</td><td class="ev-td ev-td-num num" style="color: var(--tk-green)">${r[2]}</td><td class="ev-td ev-td-num num" style="color: var(--tk-red)">${r[3]}</td><td class="ev-td num" style="white-space: nowrap">${r[4]}</td></tr>`).join("")}</tbody>
    </table>
  </div>`;
  const title = `<div style="display: flex; align-items: center; gap: 12px">
      <div class="btn btn-subtle" style="height: 26px; padding: 0 6px; margin-left: -6px">${icon("arrowLeft", 14)}Leaderboard</div>
      <div style="font-size: 13.6px; font-weight: 600">Alex Rivera</div>
      <span class="badge badge-accent">you</span>
      <div style="font-size: 10.56px; color: var(--tk-muted-text)">@alexrivera · 2026-08-03 → 2026-09-02 · trend on</div>
    </div>
    <div style="font-size: 10.56px; color: var(--tk-muted-text)">14 of 14 metrics resolved</div>`;
  const content = `<div style="display: grid; grid-template-columns: 256px minmax(0, 1fr); gap: 18px; align-items: start">
    <div style="display: flex; flex-direction: column; gap: 12px">${rail}</div>
    <div style="display: flex; flex-direction: column; gap: 9.6px; min-width: 0">
      <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 12px">
        <div>
          <div style="font-size: 17.6px; font-weight: 700; line-height: 1.35">MRs merged</div>
          <div style="font-size: 10.56px; color: var(--tk-muted-text); max-width: 560px">Count of MRs the user authored that merged in the window. With a Linear team set, only MRs that reference an ACME ticket count.</div>
        </div>
        <div class="num" style="display: flex; align-items: baseline; gap: 9.6px">
          <span style="font-size: 21.6px; font-weight: 700">14</span>
          <span style="font-size: 12.16px; color: var(--tk-muted-text)">#1</span>
          <span style="font-size: 12.16px">${deltaCell("+3", COLS[3])}</span>
        </div>
      </div>
      <div style="font-size: 11.2px; color: var(--tk-muted-text)">14 merged · 2 without an ACME ticket excluded · 1,988 lines net after file exclusions</div>
      ${ev}
    </div>
  </div>`;
  return shell({ title, content, activeRail: "leaderboard", height: 900 });
}

// --- Settings ---
function settings() {
  const scope = (kind, where) => {
    const color = kind === "team" ? "var(--tk-purple)" : kind === "user" ? "var(--tk-cyan)" : "var(--tk-muted)";
    return `<div class="scope"><span class="dot" style="background: ${color}"></span>${where}</div>`;
  };
  const row = (label, key, desc, value, sc, extra = "", editable = true) => `<div class="setting-row">
    <div><div style="font-size: 12.16px; font-weight: 600">${label}</div><div style="font-size: 10.56px; color: var(--tk-muted)">${key}</div></div>
    <div style="min-width: 0"><div style="font-size: 11.2px; color: var(--tk-muted-text); margin-bottom: 3px">${desc}</div><div class="num" style="font-size: 11.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${value}</div>${extra}</div>
    ${sc}
    <div style="width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--tk-muted-text)">${editable ? icon("pencil", 14) : ""}</div>
  </div>`;
  const rosterRows = PEOPLE.map((p, i) => {
    const hidden = false;
    return `<div style="display: grid; grid-template-columns: 200px minmax(0, 1fr) 90px; gap: 12px; align-items: center; padding: 4.8px 9.6px; border-top: 1px solid var(--tk-border-soft); font-size: 11.2px">
      <div style="color: var(--tk-fg)">${p.user}</div>
      <div style="color: var(--tk-muted-text)">${p.name}${i >= 5 ? ` <span class="badge badge-muted" style="margin-left: 6px">not on the board</span>` : ""}</div>
      <div style="display: flex; align-items: center; gap: 6px; justify-content: flex-end; color: var(--tk-muted-text); font-size: 10.56px">${icon("eyeOff", 12)}<div class="switch ${hidden ? "switch-on" : "switch-off"}"><div class="thumb" style="${hidden ? "right: 2px" : "left: 2px"}"></div></div></div>
    </div>`;
  }).join("");
  const rosterPanel = `<div class="paper" style="margin-top: 7.2px; overflow: hidden">
      <div style="display: grid; grid-template-columns: 200px minmax(0, 1fr) 90px; gap: 12px; padding: 6px 9.6px; font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--tk-muted-text)"><div>GitLab username</div><div>Name</div><div style="text-align: right">Hide for me</div></div>
      ${rosterRows}
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 7.2px 9.6px; border-top: 1px solid var(--tk-border-soft)">
        <div class="btn" style="height: 26px; padding: 0 9.6px; font-size: 10.56px">${icon("plus", 12)}Add member</div>
        <div style="font-size: 10.56px; color: var(--tk-muted-text)">Hidden members keep their data; they leave the table only for you.</div>
      </div>
    </div>`;
  const section = (title, sub, body) => `<div>
    <div style="display: flex; align-items: baseline; gap: 9.6px; margin-bottom: 7.2px"><div style="font-size: 13.6px; font-weight: 700">${title}</div><div style="font-size: 10.56px; color: var(--tk-muted-text)">${sub}</div></div>
    <div class="paper" style="overflow: hidden">${body}</div>
  </div>`;
  const team = section("Team", "acme-web · team store · local until committed and pushed",
    row("Roster", "mattstack.roster", "The people every mattstack app scores, lists, and routes to. Shared with the board.", "7 members", scope("team", "team store"), rosterPanel) +
    row("Projects", "boxscore.projects", "GitLab projects whose merge requests count.", "acme/acme-web", scope("team", "team store")) +
    row("Linear done states", "boxscore.linearDoneStates", "Ticket states that count as delivered. Empty means completed plus canceled types.", "Done · Ready for Merge · Ready for Testing · Deployed, Disabled · Ready for Release · Ready for CE · Carrier QA · Testing", scope("team", "team store")) +
    row("Size band", "boxscore.sizeBand", "Changed lines that make a merged MR reviewable.", "10 to 400 lines", scope("team", "team store")) +
    row("File exclusions", "boxscore.excludeFilePatterns", "Globs left out of added and deleted line counts.", "**/*.json · **/graphql.ts", scope("team", "team store")) +
    row("Ignored MRs", "boxscore.ignoredMrs", "Merge requests removed from every metric, as !iid or project!iid.", "none", scope("unset", "unset")) +
    row("Bot patterns", "boxscore.botPatterns", "Extra regexes for service accounts, beyond the built-ins and the board's bot list.", "^service_account_ · Mr. MR", scope("team", "team store")));
  const you = section("You", "user store · follows you to every machine",
    row("Hidden members", "boxscore.hiddenMembers", "Roster members left out of your leaderboard.", "none", scope("unset", "unset")) +
    row("Default range", "boxscore.defaultRange", "The window the leaderboard opens on.", "30d", scope("user", "user store")));
  const from = section("Read from the suite", "not editable here",
    row("GitLab host", "mattstack.integrations · forge.host", "Where merge requests are fetched from.", "https://gitlab.com", scope("team", "team store"), "", false) +
    row("Linear team", "mattstack.integrations · linear.teamKey", "Only tickets with this prefix count toward delivery.", "ACME", scope("team", "team store"), "", false) +
    row("Tokens", "secrets · rt domain", "GitLab and Linear tokens come from the secrets store, never from settings.", "gitlabToken set · linearApiKey set", scope("unset", "secrets"), "", false));
  const title = `<div style="font-size: 13.6px; font-weight: 600">Settings</div><div style="font-size: 10.56px; color: var(--tk-muted-text)">rt settings explain &lt;key&gt; shows the full chain</div>`;
  const content = `<div style="display: flex; flex-direction: column; gap: 18px; max-width: 1080px">${team}${you}${from}</div>`;
  return shell({ title, content, activeRail: "settings", height: 1280 });
}

// --- Document wrapper ---
function doc(body, height) {
  const props = { dark: { editor: "boolean", default: true, section: "Scheme" }, $preview: { width: 1440, height } };
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${STYLE}</style>
</helmet>
${body}
</x-dc>
<script data-dc-script data-props='${JSON.stringify(props)}'>
const DAY = ${JSON.stringify(DAY)};
const NIGHT = ${JSON.stringify(NIGHT)};
class Component extends DCLogic {
  renderVals() {
    return { c: this.props.dark ?? true ? NIGHT : DAY };
  }
}
</script>
</body>
</html>
`;
}

const boards = {
  "Main.dc.html": {
    h: 900,
    body: shell({ title: leaderboardTitle(), activeRail: "leaderboard", height: 900, content: controls({ trend: false, view: "Table", refreshing: false }) + leaderboardTable({ trend: false }) }),
  },
  "Refreshing.dc.html": {
    h: 900,
    body: shell({ title: leaderboardTitle(), activeRail: "leaderboard", height: 900, content: controls({ trend: true, view: "Table", refreshing: true }) + progressStrip() + warnings() + leaderboardTable({ trend: true }) }),
  },
  "Cards.dc.html": {
    h: 1180,
    body: shell({ title: leaderboardTitle(), activeRail: "leaderboard", height: 1180, content: controls({ trend: true, view: "Cards", refreshing: false }) + cards() }),
  },
  "Detail.dc.html": { h: 900, body: detail() },
  "Settings.dc.html": { h: 1280, body: settings() },
};

for (const [name, b] of Object.entries(boards)) {
  writeFileSync(join(here, name), doc(b.body, b.h));
}

const canvas = {
  artboards: [
    { file: "Main.dc.html", title: "Leaderboard", x: 0, y: 0, w: 1440, h: 900 },
    { file: "Refreshing.dc.html", title: "Leaderboard · refreshing, trend on", x: 1540, y: 0, w: 1440, h: 900 },
    { file: "Cards.dc.html", title: "Cards view · trend on", x: 0, y: 1040, w: 1440, h: 1180 },
    { file: "Detail.dc.html", title: "Person detail · evidence", x: 1540, y: 1040, w: 1440, h: 900 },
    { file: "Settings.dc.html", title: "Settings", x: 1540, y: 2080, w: 1440, h: 1280 },
  ],
  annotations: [
    { id: "brief", x: 0, y: -170, w: 520, text: "Boxscore on app-kit. Matched: Tokyo Day/Night tokens, JetBrains Mono 13.5px, console's 48px header + 40px page row, 68px rail, 6px radii, Mantine table spacing.\nEach artboard has a Dark tweak. Metric values are sample data; the roster is the live acme-web one plus boxscore's two extras." },
    { id: "settings-note", x: 0, y: 2320, w: 520, text: "Settings: sections mirror the scopes in the spec (team, user, read-only suite values). Roster is the featured composite because it is the shared key.\nEdits go through settings-kit; team values are local until committed and pushed, so the section header says so." },
  ],
  launch: { view: "canvas" },
};
writeFileSync(join(here, "canvas.json"), JSON.stringify(canvas, null, 2) + "\n");
console.log("wrote", Object.keys(boards).join(", "), "+ canvas.json");
