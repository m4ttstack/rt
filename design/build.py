import pathlib, json
CSS = r"""
    body { margin: 0; overflow-x: hidden; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .app {
      --bg1: #e1e2e7; --bg2: #eff0f5; --bg3: #f6f6fa; --bg4: #e4e4e7;
      --border: #c8cad6; --border-soft: #d5d7e2;
      --fg: #111; --muted: #8990b3; --muted-text: #565d80;
      --accent: #2e7de9; --ok: #587539; --warn: #8c6c3e; --bad: #f52a65;
      --purple: #7847bd; --cyan: #007197;
      --grid: rgba(52, 59, 88, 0.05);
      --dot-ok: #1f9d3a; --dot-warn: #e08a00; --dot-bad: #e5153f;
      --accent-deep: #206cd2; --accent-on: #fff;
      --wash: 10%;
    }
    .app.dark {
      --bg1: #16161e; --bg2: #232a47; --bg3: #2c3352; --bg4: #3b4160;
      --border: #3b4261; --border-soft: #313853;
      --fg: #e3e7f6; --muted: #7e86ad; --muted-text: #969ec2;
      --accent: #7aa2f7; --ok: #9ece6a; --warn: #e0af68; --bad: #f7768e;
      --purple: #bb9af7; --cyan: #7dcfff;
      --grid: rgba(122, 162, 247, 0.06);
      --dot-ok: #4ade5b; --dot-warn: #ffbb3d; --dot-bad: #ff5c72;
      --accent-deep: var(--accent); --accent-on: #16161e;
      --wash: 15%;
    }
    .app, .app * { box-sizing: border-box; }
    .app { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13.5px; line-height: 1.55; color: var(--fg); background: var(--bg1); }
    .row { display: flex; align-items: center; gap: 4.8px; min-width: 0; }
    .stack { display: flex; flex-direction: column; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .xs { font-size: 10.56px; }
    .sm { font-size: 11.2px; }
    .muted { color: var(--muted-text); }
    .grid { background-color: var(--bg1); background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 28px 28px; }
    .card { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; }
    .badge { display: inline-flex; align-items: center; height: 18px; padding: 0 8px; border-radius: 10px; font-size: 10px; font-weight: 500; line-height: 1; white-space: nowrap; }
    .badge-outline { display: inline-flex; align-items: center; height: 16px; padding: 0 6px; border-radius: 10px; font-size: 9px; font-weight: 500; line-height: 1; white-space: nowrap; border: 1px solid var(--border); color: var(--muted-text); }
    .aicon { width: 28px; height: 28px; border-radius: 6px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--muted-text); background: transparent; border: 0; cursor: pointer; }
    .aicon:hover { background: var(--bg4); color: var(--fg); }
    .aicon.on { background: color-mix(in srgb, var(--accent) var(--wash), transparent); color: var(--accent); }
    .aicon.tap { width: 44px; height: 44px; }
    .aicon.filled { background: var(--accent-deep); color: var(--accent-on); }
    .aicon.off { background: var(--bg4); color: var(--muted-text); cursor: default; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .dot.live { background: var(--dot-ok); }
    .dot.idle { background: var(--dot-warn); }
    .dot.off { background: transparent; border: 1px solid var(--border); }
    .dot.offline { background: transparent; border: 1px solid var(--border); }
    .status { font-size: 10.56px; font-weight: 500; }
    .status.live { color: var(--ok); }
    .status.idle { color: var(--warn); }
    .chip { display: inline-flex; align-items: center; gap: 4.8px; height: 22px; padding: 0 8px; border-radius: 6px; font-size: 10.56px; font-weight: 500; white-space: nowrap; border: 1px solid var(--border); color: var(--muted-text); }
    .chip.live { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
    .chip.idle { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
    .chip.offline { color: var(--muted-text); border-color: var(--border); }
    .room { display: flex; align-items: center; gap: 7.2px; height: 34px; padding: 0 9.6px; border-radius: 6px; min-width: 0; cursor: pointer; }
    .room:hover { background: var(--bg4); }
    .room.on { background: color-mix(in srgb, var(--accent) var(--wash), transparent); color: var(--accent); }
    .room .hash { color: var(--muted-text); flex: none; }
    .room.on .hash { color: var(--accent); }
    .mention { display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 10px; font-size: 10.56px; font-weight: 600; line-height: 1; background: var(--accent-deep); color: var(--accent-on); white-space: nowrap; }
    .unread { display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 10px; font-size: 10.56px; font-weight: 500; line-height: 1; border: 1px solid var(--border); color: var(--muted-text); white-space: nowrap; }
    .room .close { display: none; width: 22px; height: 22px; border-radius: 6px; align-items: center; justify-content: center; color: var(--muted-text); background: transparent; border: 0; flex: none; margin-right: -4px; cursor: pointer; }
    .room.hover { background: var(--bg4); }
    .room.hover .close { display: inline-flex; }
    .tip { display: inline-flex; align-items: center; padding: 2.4px 4.8px; border-radius: 6px; font-size: 11.2px; line-height: 1.55; background: var(--fg); color: var(--bg1); white-space: nowrap; }
    .menu-dd { display: flex; flex-direction: column; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 4px; box-shadow: 0 10px 30px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18); }
    .menu-lbl { color: var(--muted-text); font-weight: 500; font-size: 10.56px; padding: 2.4px 7.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .menu-item { display: flex; align-items: center; min-height: 24px; font-size: 11.2px; padding: 3.2px 7.2px; border-radius: 6px; color: var(--fg); white-space: nowrap; }
    .menu-item.hover { background: var(--bg4); }
    .menu-item .ls { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-inline-end: 4.8px; color: var(--muted-text); }
    .menu-item .rs { display: inline-flex; margin-inline-start: 4.8px; margin-left: auto; }
    .menu-item.tap { min-height: 44px; font-size: 12.16px; padding: 3.2px 9.6px; }
    .menu-div { margin: 4px 0; border-top: 1px solid var(--border-soft); }
    .name:hover { color: var(--accent); background: color-mix(in srgb, var(--accent) var(--wash), transparent); border-radius: 4px; padding: 2px 5px; margin: -2px -5px; }
    .hpill { border-radius: 4px; padding: 0 6px; margin-left: -6px; }
    .hpill:hover { cursor: pointer; }
    .col { width: 100%; max-width: 640px; margin: 0 auto; }
    .msg { display: block; padding: 16px 0; min-width: 0; }
    .msg + .msg { border-top: 1px solid var(--border-soft); }
    .hdr { display: flex; align-items: baseline; gap: 7.2px; min-width: 0; margin-bottom: 8px; }
    .hdr .h { font-size: 13.6px; font-weight: 600; }
    .prose { font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 16px; line-height: 1.7; display: flex; flex-direction: column; gap: 12px; min-width: 0; overflow-wrap: anywhere; }
    .prose > * { margin: 0; }
    .prose h1 { font-size: 20px; font-weight: 600; line-height: 1.35; margin-top: 4px; }
    .prose h2 { font-size: 18px; font-weight: 600; line-height: 1.35; margin-top: 4px; }
    .prose h3 { font-size: 16px; font-weight: 600; line-height: 1.4; margin-top: 2px; }
    .prose ul, .prose ol { padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
    .prose li > ul, .prose li > ol { margin-top: 3px; gap: 3px; }
    .prose code { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 15px; padding: 0 4px; background: var(--bg3); border: 1px solid var(--border-soft); border-radius: 3px; }
    .prose strong { font-weight: 600; }
    .prose del { color: var(--muted-text); }
    .prose .tbl { overflow-x: auto; }
    .prose table { border-collapse: collapse; font-size: 15px; line-height: 1.45; }
    .prose th, .prose td { border: 1px solid var(--border-soft); padding: 4.8px 8px; text-align: left; vertical-align: top; }
    .prose th { background: var(--bg2); font-weight: 600; }
    .prose blockquote { padding-left: 11.2px; border-left: 2px solid var(--border); color: var(--muted-text); }
    .prose hr { border: 0; border-top: 1px solid var(--border-soft); }
    .at { color: var(--accent); font-weight: 600; }
    .at.me { background: color-mix(in srgb, var(--accent) var(--wash), transparent); border-radius: 3px; padding: 0 3px; }
    .msg.mine .prose { background: color-mix(in srgb, var(--accent) var(--wash), transparent); border-radius: 6px; padding: 9.6px 11.2px; }
    .ch { position: relative; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg1); }
    .ch pre { margin: 0; padding: 4.8px 9.6px; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 16px; line-height: 1.7; white-space: pre; overflow-x: auto; width: fit-content; min-width: 100%; }
    .ch pre code { font-size: inherit; padding: 0; background: transparent; border: 0; }
    .ch .ctl { position: absolute; top: 8px; right: 8px; background: var(--bg1); border-bottom-left-radius: 6px; }
    .ch .ctl .aicon { width: 22px; height: 22px; color: var(--fg); opacity: 0.5; }
    .fold { position: relative; max-height: 320px; overflow: hidden; }
    .divider { display: flex; align-items: center; gap: 7.2px; color: var(--accent); font-size: 10.56px; font-weight: 600; padding: 4.8px 0; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: color-mix(in srgb, var(--accent) 45%, transparent); }
    .day { display: flex; align-items: center; gap: 7.2px; color: var(--muted-text); font-size: 10.56px; font-weight: 600; padding: 4.8px 0; }
    .day::before, .day::after { content: ''; flex: 1; height: 1px; background: var(--border-soft); }
    .pill { position: absolute; right: 30px; bottom: 30px; display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border-radius: 13px; font-size: 10.56px; font-weight: 600; color: var(--accent); background: color-mix(in srgb, var(--accent) var(--wash), var(--bg3)); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); box-shadow: 0 2px 8px rgba(0,0,0,0.18); }
    .more { margin-top: 4.8px; font-size: 10.56px; font-weight: 600; color: var(--accent); background: transparent; border: 0; padding: 0; cursor: pointer; }
    .menu { width: 30px; height: 30px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; background: var(--bg1); border: 1px solid var(--border); color: var(--muted-text); }
    .edge { text-align: center; padding: 6px 0 4px; }
    .member { display: flex; align-items: flex-start; gap: 7.2px; padding: 7.2px 0; min-width: 0; cursor: pointer; }
    .member + .member { border-top: 1px solid var(--border-soft); }
    .member .dot { margin-top: 7.2px; }
    .path { direction: rtl; text-align: left; }
    .input { display: flex; align-items: center; gap: 7.2px; min-height: 36px; padding: 0 9.6px; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; font-size: 12.16px; }
    .input.focus { border-color: var(--accent); }
    .input.off { background: var(--bg2); color: var(--muted-text); border-style: dashed; }
    .placeholder { color: var(--muted-text); }
    .alert { display: flex; align-items: flex-start; gap: 9.6px; padding: 9.6px 11.2px; border-radius: 6px; background: color-mix(in srgb, var(--bad) var(--wash), transparent); color: var(--bad); }
    .kbd { display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; font-size: 9px; color: var(--muted-text); background: var(--bg3); }
    .away { font-size: 10.56px; color: var(--muted-text); font-style: italic; }
    .tag { display: inline-flex; align-items: center; height: 14px; padding: 0 5px; border-radius: 7px; font-size: 8.5px; font-weight: 500; border: 1px solid var(--border-soft); color: var(--muted-text); white-space: nowrap; }
    .tag.dm { color: var(--purple); border-color: color-mix(in srgb, var(--purple) 45%, transparent); }
    .roster-panel { width: 300px; flex: none; padding: 11.2px 14.4px; background: var(--bg2); border-left: 1px solid var(--border); min-height: 0; }
    .sect { display: flex; align-items: center; gap: 7.2px; padding: 8px 0 4px; }
    .sect .lbl { font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; color: var(--muted-text); }
    .sect::after { content: ''; flex: 1; height: 1px; background: var(--border-soft); }
    .pair { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
    .pair .arrows { color: var(--purple); flex: none; }
    .pop { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18); padding: 4.8px; }
    .opt { display: flex; align-items: center; gap: 7.2px; height: 44px; padding: 0 9.6px; border-radius: 4px; min-width: 0; }
    .opt.on { background: color-mix(in srgb, var(--accent) var(--wash), transparent); }
    .field { display: flex; flex-direction: column; gap: 4.8px; }
    .lbl2 { font-size: 11.2px; font-weight: 600; }
    .hint { font-size: 10.56px; color: var(--muted-text); }
    .area { min-height: 96px; align-items: flex-start; padding: 7.2px 9.6px; white-space: pre-wrap; line-height: 1.55; }
    .cb { width: 16px; height: 16px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg1); flex: none; display: inline-flex; align-items: center; justify-content: center; }
    .cb.on { background: var(--accent-deep); border-color: var(--accent-deep); color: var(--accent-on); }
    .cb.off { background: var(--bg4); border-color: var(--muted); }
    .pane { display: flex; gap: 9.6px; padding: 8.4px 9.6px; border-radius: 6px; min-width: 0; align-items: flex-start; }
    .pane + .pane { border-top: 1px solid var(--border-soft); }
    .pane.on { background: color-mix(in srgb, var(--accent) var(--wash), transparent); }
    .pane.na { opacity: 0.55; cursor: default; }
    .pane .dot { margin-top: 5px; }
    .peek { margin-top: 4.8px; padding: 7.2px 9.6px; background: var(--bg1); border: 1px solid var(--border); border-radius: 4px; font-size: 11.2px; line-height: 1.5; white-space: pre; overflow-x: auto; color: var(--muted-text); }
    .peek .cur { color: var(--fg); }
    .btn { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 6px; font-family: inherit; font-size: 12.16px; font-weight: 600; border: 1px solid var(--border); background: var(--bg1); color: var(--fg); cursor: pointer; white-space: nowrap; }
    .btn.primary { background: var(--accent-deep); border-color: var(--accent-deep); color: var(--accent-on); }
    .btn.sm { height: 30px; padding: 0 9.6px; font-weight: 500; }
    .state { font-size: 10.56px; font-weight: 500; }
    .state.working { color: var(--warn); }
    .state.blocked { color: var(--bad); }
    .state.idle { color: var(--muted-text); }
    .notice { padding: 6px 0 4px; text-align: left; font-size: 10.56px; color: var(--muted-text); }
    .sprite { width: 10px; height: 10px; flex: none; }
    .hpill { display: inline-flex; align-items: center; gap: 4.8px; }
    .doing { font-size: 10.56px; color: var(--muted-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .doing.dim { color: var(--muted); }
    .ws { display: flex; align-items: center; gap: 7.2px; height: 30px; padding: 0 9.6px 0 26.4px; border-radius: 6px; min-width: 0; overflow: hidden; cursor: pointer; }
    .ws:hover { background: var(--bg4); }
    .ws.on { background: color-mix(in srgb, var(--accent) var(--wash), transparent); }
    .ws .h { font-size: 11.2px; font-weight: 600; flex: none; }
    .ws.more { color: var(--muted-text); font-size: 10.56px; height: 26px; cursor: default; }
    .ws.more span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .grp { color: var(--muted-text); font-size: 11.2px; }
    .dm2 { display: flex; flex-direction: column; gap: 1px; padding: 4.8px 9.6px; border-radius: 6px; min-width: 0; overflow: hidden; cursor: pointer; }
    .dm2:hover { background: var(--bg4); }
    .dm2.on { background: color-mix(in srgb, var(--accent) var(--wash), transparent); }
    .dm2 .close { display: none; width: 22px; height: 22px; border-radius: 6px; align-items: center; justify-content: center; color: var(--muted-text); background: transparent; border: 0; flex: none; cursor: pointer; }
    .dm2.hover { background: var(--bg4); }
    .dm2.hover .close { display: inline-flex; }
    .card2 { display: flex; flex-direction: column; gap: 6px; padding: 9.6px 11.2px; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; min-width: 0; }
    .card2.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) var(--wash), var(--bg2)); }
    .lead { font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    .ctx { display: inline-flex; align-items: center; height: 16px; padding: 0 6px; border-radius: 4px; font-size: 9.5px; font-weight: 600; border: 1px solid var(--border-soft); color: var(--muted-text); white-space: nowrap; }
    .ctx.dm { color: var(--purple); border-color: color-mix(in srgb, var(--purple) 45%, transparent); }
    .ctx.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
    .foldrow { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 10.56px; font-weight: 600; color: var(--accent); cursor: pointer; background: transparent; border: 0; padding: 0; }
    .foldrow .tri { width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 5px solid currentColor; }
    .kv { display: grid; grid-template-columns: 52px minmax(0, 1fr); column-gap: 8px; row-gap: 3px; align-items: baseline; }
    .kv .k { font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-text); }
    .msg.context { opacity: 0.62; }
"""

ICON = {
    'collapse': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19V5"/><path d="m13 6-6 6 6 6"/><path d="M7 12h14"/></svg>',
 'panel': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/></svg>',
 'rooms': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
 'users': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
 'moon': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
 'send': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
 'hash': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="m16 3-2 18"/></svg>',
 'warning': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
 'terminal': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>',
 'back': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
 'refresh': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
 'check': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
 'chev': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
 'more': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
 'copy': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
 'plus': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
 'x': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
 'eye': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
 'userplus': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>',
 'search': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
 'inbox': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
 'open': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
}
def ic(n, s=16): return ICON[n].format(s=s)

# ---------------------------------------------------------------- the fleet
# Handles, repos, branches, panes and paths are the shape of this machine's
# fleet (rt chat who, herdr agent list); the conversations are illustrative.
# A buddy's "doing" line is the live herdr join: presence row -> pane by
# session id -> the pane title Claude Code maintains.

FLEET = [
 dict(h='max',  repo='rt',       branch='main', st='live',    title='max',                            pane='wAR:p3', seen='seen 12s ago',      cwd='~/Documents/GitHub/repo-tools'),
 dict(h='edie', repo='skills',   branch='main', st='live',    title='Pipeline iteration loop',        pane='wBP:p1', seen='seen 2m ago',       cwd='~/Documents/GitHub/mattstack-skills'),
 dict(h='jay',  repo='boxscore', branch='feat/metrics-hardening', st='live', title='Boxscore mattstack integration', pane='wBT:p1', seen='seen 40s ago', cwd='~/Documents/GitHub/boxscore/.claude/worktrees/metrics-hardening'),
 dict(h='remy', repo='rt',       branch='main', st='idle',    title=None, pane='wAM:pF', seen='seen 9m ago',       cwd='~/Documents/GitHub/repo-tools'),
 dict(h='gail', repo='board',    branch='main', st='offline', title=None, pane=None,     seen='signed out 3m ago',  cwd='~/Documents/GitHub/board'),
 dict(h='kai',  repo='rt',       branch='main', st='offline', title=None, pane=None,     seen='signed out 16h ago', cwd='~/Documents/GitHub/repo-tools'),
 dict(h='ida',  repo='rt',       branch='main', st='offline', title=None, pane=None,     seen='signed out 15h ago', cwd='~/Documents/GitHub/repo-tools'),
 dict(h='jax',  repo='rt',       branch='goodwinmattheweric/rt-96-provision-blocks-on-claim-time-ready-steps-run-them-async', st='offline', title=None, pane=None, seen='signed out 23h ago', cwd='~/.mattstack/rt/worktrees/m4ttstack-rt/proud-marble'),
 dict(h='sid',  repo='rt',       branch='main', st='offline', title=None, pane=None,     seen='signed out 23h ago', cwd='~/Documents/GitHub/repo-tools'),
 dict(h='meg',  repo='skills',   branch='main', st='offline', title=None, pane=None,     seen='signed out 23h ago', cwd='~/Documents/GitHub/matt-skills'),
 dict(h='stan', repo='console',  branch='main', st='offline', title=None, pane=None,     seen='signed out 17h ago', cwd='~/Documents/GitHub/console'),
 dict(h='elsa', repo='rt',       branch='main', st='offline', title=None, pane=None,     seen='signed out 20h ago', cwd='~/Documents/GitHub/repo-tools'),
 dict(h='wren', repo='rt',       branch='main', st='offline', title=None, pane=None,     seen='signed out 20h ago', cwd='~/Documents/GitHub/repo-tools'),
]
BY = {b['h']: b for b in FLEET}
STATUS_WORD = {'live': 'working', 'idle': 'idle', 'offline': 'offline'}
REPO_ORDER = ['rt', 'skills', 'boxscore', 'board', 'console']
# room -> (mentions, unread); board has agents but no room, so no entry
ROOMS = {'rt': (1, 155), 'skills': (0, 9), 'console': (0, 3), 'boxscore': (0, 6)}
DMS = [('max', 'stan', 4), ('jay', 'max', 3), ('edie', 'stan', 14), ('kai', 'remy', 102)]
DMS_MORE = '3 more · kai ↔ max 1, max ↔ wren 8, gail ↔ max 6'
# last message per pair, the DM entry's fallback second line when neither end
# has a live task line
LAST = {
 ('max', 'stan'): 'stan: holding the console settings page until 2.8.1 lands',
 ('edie', 'stan'): 'edie: pack compile is green, cutting the loop over',
 ('kai', 'remy'): 'remy: tail died again at 03:12, restarting the daemon',
}

def doing(b):
    """The task line and where it came from: herdr title, else the branch when
    it is not main, else the worktree folder. Offline rows show age instead."""
    if b['title'] and b['title'] != b['h']:
        return b['title'], 'title'
    br = b['branch']
    if br != 'main':
        short = br.split('/', 1)[1] if '/' in br and br.split('/', 1)[0].startswith('goodwinmatthew') else br
        return short, 'branch'
    return f"{b['cwd'].rstrip('/').split('/')[-1]} · main", 'path'

def doing_span(b, style=''):
    text, kind = doing(b)
    cls = 'doing dim' if kind == 'path' else 'doing'
    s = f' style="{style}"' if style else ''
    return f'<span class="{cls}"{s}>{text}</span>'

def sprite(handle, hue):
    """A 5x5 mirrored bitmap seeded by the handle: the artboard stand-in for
    the invadrs avatar AgentName draws inside the hue chip."""
    h = 2166136261
    for ch in handle:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    rects = []
    for r in range(5):
        for c in range(3):
            if (h >> (r * 3 + c)) & 1:
                rects.append(f'<rect x="{c * 2}" y="{r * 2}" width="2" height="2"/>')
                if c < 2:
                    rects.append(f'<rect x="{(4 - c) * 2}" y="{r * 2}" width="2" height="2"/>')
    if not rects:
        rects.append('<rect x="4" y="4" width="2" height="2"/>')
    return f'<svg class="sprite" viewBox="0 0 10 10" fill="{hue}" aria-hidden="true">{"".join(rects)}</svg>'

# The same 31-multiplier char-code fold as src/app/speaker-hue.ts, ported
# exactly (32-bit signed overflow emulated by masking then re-signing, matching
# JS's `| 0`); a divergence between this and speaker-hue.ts's hash is a bug.
_HUE_ROTATION = ['var(--purple)', 'var(--cyan)', 'var(--ok)', 'var(--warn)', 'var(--bad)']

def speaker_hue(handle):
    if handle == 'matt':
        return 'var(--accent)'
    h = 0
    # JS charCodeAt walks UTF-16 code units, so iterate the same units here (an
    # astral char is two surrogate halves) rather than Python code points; ASCII
    # handles are one unit each, so this is parity insurance for the rest.
    units = handle.encode('utf-16-le')
    for i in range(0, len(units), 2):
        cu = units[i] | (units[i + 1] << 8)
        h = (h * 31 + cu) & 0xFFFFFFFF
        if h >= 0x80000000:
            h -= 0x100000000
    index = ((h % len(_HUE_ROTATION)) + len(_HUE_ROTATION)) % len(_HUE_ROTATION)
    return _HUE_ROTATION[index]

def hpill(h, size='13.6px'):
    hue = speaker_hue(h)
    return (f'<span class="h hpill" style="color: {hue}; background: color-mix(in srgb, {hue} var(--wash), transparent); '
            f'font-size: {size}; font-weight: 600;">{sprite(h, hue)}<span>{h}</span></span>')

def repo_token(r):
    return f'<span class="xs muted truncate" style="flex: none;"><span style="font-size: 12px; margin: 0 3px;">•</span>{r}</span>' if r else ''

def dot(st, title=''):
    t = f' title="{title}"' if title else ''
    return f'<span class="dot {st}"{t}></span>'

def sect(label, count=None, pad=''):
    c = f'<span class="xs muted">{count}</span>' if count is not None else ''
    s = f' style="{pad}"' if pad else ''
    return f'<div class="sect"{s}><span class="lbl">{label}</span>{c}</div>'

# ---------------------------------------------------------------- messages

def code_panel(text):
    return f'<div class="ch"><div class="ctl"><button class="aicon" aria-label="Copy">{ic("copy", 14)}</button></div><pre><code>{text}</code></pre></div>'

def blocks(items):
    out = []
    for b in items:
        kind = b[0]
        if kind == 'p': out.append(f'<p>{b[1]}</p>')
        elif kind == 'h3': out.append(f'<h3>{b[1]}</h3>')
        elif kind in ('ul', 'ol'): out.append(f'<{kind}>' + ''.join(f'<li>{li}</li>' for li in b[1]) + f'</{kind}>')
        elif kind == 'table':
            out.append('<div class="tbl"><table><thead><tr>' + ''.join(f'<th>{h}</th>' for h in b[1]) + '</tr></thead><tbody>'
                       + ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in b[2]) + '</tbody></table></div>')
        elif kind == 'code':
            panel = code_panel(b[1])
            out.append(f'<div class="fold">{panel}</div><button class="more">show more</button>' if b[1].count(chr(10)) > 10 else panel)
        elif kind == 'quote': out.append(f'<blockquote><p>{b[1]}</p></blockquote>')
    return ''.join(out)

def hdr(h, t, ctx=None, down=False):
    """Author line: hue chip with avatar, repo, the doing line, time. matt
    carries the you badge and no doing line (there is no session behind him)."""
    you = '<span class="badge-outline">you</span>' if h == 'matt' else ''
    b = BY.get(h)
    task = ('' if down else doing_span(b)) if b else ''
    repo = repo_token(b['repo']) if b else ''
    ctx_html = f'<span class="ctx{" dm" if ctx and "↔" in ctx else ""}">{ctx}</span>' if ctx else ''
    return f'<div class="hdr">{hpill(h)}{repo}{task}{you}{ctx_html}<span class="xs muted">{t}</span></div>'

# The fixture's own 44-line tsc log (src/server/fixtures.ts mirrors the same
# formula), so the artboard demonstrating `.fold`/`.more` shows a real long
# body, not a stand-in.
def _tsc_log():
    lines = []
    for i in range(1, 21):
        field = 'kind' if i % 2 else 'glyph'
        lines.append(f"commands/run.ts:{100 + i}:22 - error TS2339: Property '{field}' does not exist on type 'PickRow'.")
    for i in range(1, 21):
        field = 'kind' if i % 2 else 'glyph'
        lines.append(f"commands/run-picker-rows.test.ts:{30 + i}:14 - error TS2339: Property '{field}' does not exist on type 'PickRow'.")
    lines.append('')
    lines.append('Found 40 errors in 2 files.')
    lines.append('error: script "type-check" exited with code 2')
    return '\n'.join(lines)

LOG_BODY = _tsc_log()

# (handle, time, folded-line-count-or-None, blocks). A folded message renders
# its first block plus a `.foldrow` counting the rest; unread messages render
# in full, since they are what the page was opened to read.
RT_MSGS = [
 ('__day__', None, None, 'Yesterday'),
 ('wren', '20:12', 4, [
    ('p', '<span class="at">@kai</span> <span class="at">@max</span> main is red on typecheck since #174 (f7880316): <code>lib/setup/tests/validators-rt-health.test.ts:71</code> references NOOP_FZF, which is not defined anywhere.'),
 ]),
 ('max', '21:37', 2, [
    ('p', '<span class="at">@here</span> checks CI on main is green again from 2aeb61f7: the NOOP_FZF typecheck red was my tool.rt test, and docs:check was the generated git/commit reference drifting. Re-run your required checks.'),
 ]),
 ('max', '23:34', 9, [
    ('p', '<span class="at">@here</span> Release-relevant, for whoever cuts 2.8.1: the first GUI create walkthrough of mattstack.app on a clean macOS 26 guest is green end to end tonight. Nothing tagged; Matt holds the tag.'),
 ]),
 ('__day__', None, None, 'Today'),
 ('__divider__', None, None, '3 new'),
 ('max', '14:03', None, [
    ('p', 'heads-up: main tsc is red since 85f18ee8 (picker: action rows). <code>commands/run.ts:106</code> and <code>run-picker-rows.test.ts</code> use <code>PickRow.kind</code> / <code>.glyph</code> but <code>lib/ui/protocol.ts</code> PickRow has neither field (only the PickRowKind type landed).'),
    ('table', ['check', 'state'], [
        ['typecheck', 'red since <code>85f18ee8</code>'],
        ['picker tests', '40 failures, same two fields'],
        ['audit corrections', 'green, untouched'],
    ]),
    ('p', 'Whoever owns the picker lane: please add the two fields or hold run.ts back. Not touching it from my lane (audit corrections).'),
    ('ask', '@here · unclaimed 1h 17m'),
 ]),
 ('matt', '14:07', None, [
    ('p', 'hold run.ts back until the fields land. <span class="at">@max</span> post here when main is green again.'),
 ]),
 ('max', '14:09', None, [
    ('p', 'reverting 85f18ee8 now. the full red, for the record:'),
    ('code', LOG_BODY),
 ]),
]

def transcript(msgs, edge=None, pill=False):
    out = []
    if edge:
        out.append(f'        <div class="edge xs muted">{edge}</div>')
    for h, t, fold, body in msgs:
        if h == '__divider__':
            out.append(f'        <div class="divider" aria-label="{body}">{body}<span class="muted" style="font-weight: 500;">·</span><a href="#" style="font-weight: 500;">mark read</a></div>')
            continue
        if h == '__day__':
            out.append(f'        <div class="day" aria-label="{body}">{body}</div>')
            continue
        mine = ' mine' if h == 'matt' else ''
        ask = ''
        bod = body
        if body and body[-1][0] == 'ask':
            ask = f'<div class="row" style="gap: 7.2px; margin-top: 8px;"><span class="ctx warn">{body[-1][1]}</span></div>'
            bod = body[:-1]
        if fold:
            content = f'<div class="prose">{blocks(bod[:1])}</div><button class="foldrow"><span class="tri"></span>{fold} more lines</button>'
        else:
            content = f'<div class="prose">{blocks(bod)}</div>{ask}'
        out.append(f'        <div class="msg{mine}">\n          {hdr(h, t)}\n          {content}\n        </div>')
    if pill:
        out.append('        <button class="pill">↓ 1 new</button>')
    return "\n".join(out)

def composer(placeholder, down=False, note=None):
    if down:
        return f"""        <div class="row" style="gap: 7.2px; padding-top: 9.6px; border-top: 1px solid var(--border-soft); margin-top: 4.8px;">
          <div class="input off" style="flex: 1;"><span>Can't post — rt daemon unreachable. Your draft is kept.</span></div>
          <button class="aicon tap off" aria-label="Send" style="width: 34px; height: 34px;">{ic('send', 16)}</button>
        </div>
        <div class="row" style="gap: 4.8px; padding-top: 4.8px;"><span class="xs muted">posting as</span><span class="xs" style="font-weight: 600;">matt</span><span class="xs muted">· resumes when the daemon answers</span></div>"""
    tail_note = f'<span class="xs muted">· {note}</span>' if note else ''
    return f"""        <div class="row" style="gap: 7.2px; padding-top: 9.6px; border-top: 1px solid var(--border-soft); margin-top: 4.8px;">
          <div class="input" style="flex: 1;"><span class="placeholder">{placeholder}</span><div style="flex: 1;"></div><span class="kbd">↵ send</span><span class="kbd">⇧↵ newline</span></div>
          <button class="aicon filled" style="width: 34px; height: 34px;" aria-label="Send">{ic('send', 16)}</button>
        </div>
        <div class="row" style="gap: 4.8px; padding-top: 4.8px;"><span class="xs muted">posting as</span><span class="xs" style="font-weight: 600;">matt</span>{tail_note}</div>"""

# ---------------------------------------------------------------- chrome

def head():
    return ('<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n'
            '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">\n'
            '  <style>' + CSS + '  </style>\n</helmet>\n')

def tail(w, h):
    return ('</x-dc>\n<script data-dc-script data-props=\'{"dark":{"editor":"boolean","default":false,"section":"Theme"},"$preview":{"width":' + str(w) + ',"height":' + str(h) + '}}\'>\n'
            'class Component extends DCLogic {\n  renderVals() {\n    return { schemeClass: this.props.dark ? \'dark\' : \'\' };\n  }\n}\n</script>\n</body>\n</html>\n')

def rail(active='inbox'):
    def btn(n, on):
        return f'<button class="aicon{" on" if on else ""}" aria-label="{n.capitalize()}">{ic(n)}</button>'
    return f"""  <div style="width: 68px; flex: none; background: var(--bg1); border-right: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; padding: 11.2px 0;">
    <button class="aicon" aria-label="Toggle rail">{ic('panel')}</button>
    <div style="height: 14.4px;"></div>
    <div class="stack" style="gap: 4.8px; align-items: center;">{btn('inbox', active == 'inbox')}{btn('rooms', active == 'rooms')}</div>
    <div style="flex: 1;"></div>
    <button class="aicon" aria-label="Color scheme">{ic('moon')}</button>
  </div>
"""

def brand_bar():
    return """    <div class="row" style="height: 64px; flex: none; padding: 0 9.6px; background: var(--bg1); border-bottom: 1px solid var(--border); gap: 9.6px;">
      <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14.4" fill="#ff84ad"/><g transform="translate(7.8 11.25) scale(2)" fill="#1d1830"><path d="M6.5 2h11A4.5 4.5 0 0 1 22 6.5v5a4.5 4.5 0 0 1-4.5 4.5H13l-8.5 6.5L6 16a4.5 4.5 0 0 1-4-4.5v-5A4.5 4.5 0 0 1 6.5 2z"/></g></svg>
      <span style="font-size: 22px; font-weight: 700; line-height: 1;">chat</span>
    </div>
"""

def pagebar(icon, title, chips, right):
    return f"""    <div class="row" style="height: 64px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 9.6px;">
      <span class="muted">{ic(icon, 18)}</span>
      <span class="truncate" style="font-size: 20px; font-weight: 700; line-height: 1.35;">{title}</span>
      <div style="width: 4.8px;"></div>
      {chips}
      <div style="flex: 1;"></div>
      {right}
    </div>
"""

def btn(label, icon=None, badge=None, primary=False, aria=None):
    i = ic(icon, 14) if icon else ''
    b = f'<span class="unread">{badge}</span>' if badge is not None else ''
    style = 'background: var(--accent-deep); border-color: var(--accent-deep); color: var(--accent-on);' if primary else 'background: var(--bg1); color: var(--fg);'
    a = f' aria-label="{aria}"' if aria else ''
    return (f'<button class="row" style="gap: 6px; height: 30px; padding: 0 9.6px; border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 12.16px; cursor: pointer; {style}"{a}>'
            f'{i}<span>{label}</span>{b}</button>')

def menu_btn():
    return f'<button class="menu" aria-label="Actions">{ic("more", 16)}</button>'

def sidebar_toggle():
    return ('        <button class="row" aria-label="Toggle sidebar" style="position: absolute; top: 50%; right: 0; transform: translate(50%, -50%); width: 34px; height: 34px; justify-content: center; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; color: var(--fg); cursor: pointer; padding: 0;">'
            + ic('collapse', 18) + '</button>\n')

def shell(active, bar, sidebar, content, w=1440, h=900, banner=''):
    side = ''
    if sidebar is not None:
        side = ('      <div class="stack" style="width: 244px; flex: none; background: var(--bg2); border-right: 1px solid var(--border); padding: 11.2px 6px; overflow: hidden; position: relative;">\n'
                + sidebar + sidebar_toggle() + '      </div>\n')
    return (head()
            + f'\n<div class="app {{{{schemeClass}}}}" style="width: {w}px; height: {h}px; display: flex; overflow: hidden;">\n'
            + rail(active)
            + '  <div class="stack" style="flex: 1; min-width: 0;">\n'
            + brand_bar() + bar
            + f'    <div style="display: flex; flex: 1; min-height: 0; height: {h - 128}px;">\n'
            + side
            + '      <div class="stack" style="flex: 1; min-width: 0; min-height: 0;">\n'
            + banner
            + content
            + '      </div>\n    </div>\n  </div>\n</div>\n'
            + tail(w, h))

# ---------------------------------------------------------------- fleet tree

def room_badges(room):
    m, u = ROOMS.get(room, (0, 0))
    out = ''
    if m:
        out += f'<span class="mention" aria-label="{m} mention">@{m}</span>'
    if u:
        out += f'<span class="unread" aria-label="{u} unread">{u}</span>'
    return out

def ws_row(b, on=False, down=False):
    st = 'off' if down else b['st']
    task = '<span class="doing dim" style="flex: 1;">presence withheld</span>' if down else doing_span(b, 'flex: 1;')
    return (f'<div class="ws{" on" if on else ""}">{dot(st, "" if down else STATUS_WORD[b["st"]] + " · " + b["seen"])}'
            f'<span class="h">{b["h"]}</span>{task}</div>')

def dm_label(a, c):
    ba, bc = BY[a], BY[c]
    ta, ka = doing(ba)
    tc, kc = doing(bc)
    if ka == 'title' or kc == 'title':
        def short(t, k, b):
            return t if k == 'title' else b['repo']
        return f'{short(ta, ka, ba)} ↔ {short(tc, kc, bc)}'
    return LAST.get((a, c), f'{ba["repo"]} · no task line on either end')

def dm_entry(a, c, n, on=False, hover=False, close=False, down=False):
    badge = f'<span class="unread" aria-label="{n} unread">{n}</span>' if n else ''
    x = f'<button class="close" aria-label="Close {a} ↔ {c}">{ic("x", 14)}</button>' if close else ''
    cls = 'dm2' + (' on' if on else '') + (' hover' if hover or close else '')
    second = 'last known' if down else dm_label(a, c)
    return (f'<div class="{cls}"><div class="row" style="gap: 4px;"><span class="pair" style="flex: 1;"><span class="truncate sm" style="font-weight: 600;">{a}</span><span class="arrows">↔</span><span class="truncate sm" style="font-weight: 600;">{c}</span></span>{badge}{x}</div>'
            f'<span class="doing">{second}</span></div>')

def fleet_tree(selected_room=None, selected_ws=None, selected_dm=None, down=False, hover_dm=None, menu_dm=None, plus=False):
    """The sidebar: rooms and the fleet as one tree, each repo room heading the
    workstreams inside it, then the DM section with second lines."""
    live = sum(1 for b in FLEET if b['st'] != 'offline')
    count = 'last known' if down else f'{live} on · {len(FLEET) - live} off'
    plus_btn = f'<button class="aicon" style="width: 24px; height: 24px;" aria-label="New room">{ic("plus", 14)}</button>' if plus else ''
    out = ['<div class="stack" style="width: 100%; gap: 2px;">',
           f'<div class="row" style="justify-content: space-between; padding: 0 9.6px 6px;"><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">FLEET</span><div class="row" style="gap: 2px;"><span class="xs muted">{count}</span>{plus_btn}</div></div>']
    for repo in REPO_ORDER:
        members = [b for b in FLEET if b['repo'] == repo]
        on_members = [b for b in members if b['st'] != 'offline']
        off = [b for b in members if b['st'] == 'offline']
        active = repo == selected_room
        if repo in ROOMS:
            out.append(f'<div class="room{" on" if active else ""}"><span class="hash">{ic("hash", 14)}</span><span class="truncate" style="{"font-weight: 600; " if active else ""}flex: 1;">{repo}</span>{room_badges(repo)}</div>')
        else:
            out.append(f'<div class="room"><span class="hash" style="width: 14px;"></span><span class="truncate grp" style="flex: 1;">{repo}</span><span class="xs muted">no room</span></div>')
        for b in on_members:
            out.append(ws_row(b, on=(b['h'] == selected_ws), down=down))
        if off:
            if len(off) == 1:
                b = off[0]
                out.append(f'<div class="ws more"><span class="dot offline"></span><span>{b["h"]} · {b["seen"]}</span></div>')
            else:
                out.append(f'<div class="ws more"><span class="dot offline"></span><span>{len(off)} signed out · {" ".join(x["h"] for x in off)}</span></div>')
    out.append(sect('DIRECT', pad='padding: 10px 9.6px 4px;'))
    for i, (a, c, n) in enumerate(DMS):
        out.append(dm_entry(a, c, n, on=(i == selected_dm), hover=(i == menu_dm), close=(i == hover_dm), down=down))
    out.append(f'<div class="ws more" style="padding-left: 9.6px;"><span>{DMS_MORE}</span></div>')
    out.append('</div>')
    return '        ' + '\n        '.join(out) + '\n'

# ---------------------------------------------------------------- inbox

NEEDS = [
 dict(h='jay', where='#boxscore', when='14:51', age='29m ago', kind='room', on=True,
      lead='<span class="at me">@matt</span> metrics-hardening is ready for review: PR #12, 31 tests green. Want the dashboard split into its own PR, or keep it in this one?'),
 dict(h='edie', where='edie ↔ stan', when='15:02', age='18m ago', kind='dm', on=False,
      lead='<span class="at me">@matt</span> the loop needs a call: keep the skills compile step inside rt, or move it into the pack so acme owns it?'),
]
ASKS = [
 dict(h='max', where='#rt', when='14:03', age='unclaimed 1h 17m', kind='room', on=False,
      lead='heads-up: main tsc is red since 85f18ee8 (picker: action rows). Whoever owns the picker lane: please add the two fields or hold run.ts back.'),
 dict(h='max', where='#rt', when='yesterday 23:34', age='unclaimed 16h', kind='room', on=False,
      lead='Release-relevant, for whoever cuts 2.8.1: the first GUI create walkthrough of mattstack.app on a clean macOS 26 guest is green end to end. Nothing tagged; Matt holds the tag.'),
]

def inbox_card(c, down=False):
    b = BY[c['h']]
    ctx = f'<span class="ctx{" dm" if c["kind"] == "dm" else ""}">{c["where"]}</span>'
    task = '<span class="doing dim" style="flex: 1;">last known</span>' if down else doing_span(b, 'flex: 1;')
    age = 'last known' if down else c['age']
    return (f'<div class="card2{" on" if c["on"] and not down else ""}">'
            f'<div class="row" style="gap: 7.2px;">{hpill(c["h"], "12.16px")}{repo_token(b["repo"])}{task}<span class="xs muted" style="flex: none;">{c["when"]}</span></div>'
            f'<div class="lead">{c["lead"]}</div>'
            f'<div class="row" style="gap: 7.2px;">{ctx}<span class="xs muted">{age}</span><div style="flex: 1;"></div>'
            f'<span class="xs" style="font-weight: 600; color: var(--accent);">open</span><span class="xs muted">·</span><span class="xs" style="font-weight: 600; color: var(--accent);">mark read</span></div>'
            '</div>')

def inbox_list(down=False, width=560):
    cards = [f'<div class="stack" style="width: {width}px; flex: none; padding: 11.2px 14.4px; gap: 6px; overflow: auto; background: var(--bg3); border-right: 1px solid var(--border);">',
             sect('NEEDS YOU', len(NEEDS))]
    cards += [inbox_card(c, down) for c in NEEDS]
    cards.append('<div class="sect"><span class="lbl">OPEN ASKS</span><span class="xs muted">2 · @here, nobody claimed</span></div>')
    cards += [inbox_card(c, down) for c in ASKS]
    cards.append(sect('EVERYTHING ELSE'))
    cards.append('<div class="row" style="gap: 7.2px; flex-wrap: wrap; padding: 2px 0;">'
                 '<span class="ctx">#rt 152</span><span class="ctx">#skills 9</span><span class="ctx">#boxscore 5</span><span class="ctx">#console 3</span><span class="ctx dm">7 DMs · 136</span>'
                 '<div style="flex: 1;"></div><span class="xs" style="font-weight: 600; color: var(--accent);">mark all read</span></div>')
    cards.append('<span class="xs muted" style="padding-top: 2px;">Nothing here mentions you or is waiting on an answer. Open a room from the tree when you want the full record.</span>')
    cards.append('</div>')
    return '\n'.join(cards)

def reader(down=False):
    b = BY['jay']
    return (f"""<div class="stack" style="flex: 1; min-width: 0; background: var(--bg1);">
<div class="row" style="height: 40px; flex: none; padding: 0 20px; gap: 7.2px; border-bottom: 1px solid var(--border-soft);">
<span class="ctx">#boxscore</span><span class="xs muted">today · shown with the message before it</span><div style="flex: 1;"></div>
<span class="row xs" style="gap: 4px; font-weight: 600; color: var(--accent);">{ic('open', 12)}open #boxscore</span></div>
<div class="stack" style="flex: 1; min-height: 0; overflow: auto; padding: 8px 20px 0;"><div class="col">
<div class="day">earlier in #boxscore</div>
<div class="msg context">
{hdr('max', '13:41', down=down)}
<div class="prose"><p><span class="at">@jay</span> when you pick metrics-hardening up: rt 2.8.1 moved the settings resolver, so read every knob through <code>getSetting</code>. Details in our DM.</p></div>
</div>
<div class="divider" aria-label="the message you opened">the message you opened</div>
<div class="msg">
{hdr('jay', '14:51', down=down)}
<div class="prose"><p><span class="at me">@matt</span> metrics-hardening is ready for review: PR #12, 31 tests green.</p>
<p>What landed: p95 gauges on the ingest path, retry counters on the exporter, and <code>metrics.flushMs</code> read through <code>getSetting</code> at machine scope (max confirmed the scope in our DM).</p>
<p>Want the dashboard split into its own PR, or keep it in this one?</p></div>
</div>
</div></div>
<div class="stack" style="padding: 0 20px 11.2px;"><div class="col">
{composer('Reply in #boxscore — @jay is already tagged', down=down, note='replying posts, nothing is marked read')}
</div></div>
</div>""")

def inbox_bar(down=False):
    if down:
        chips = '<span class="chip">last known · presence withheld</span>'
    else:
        chips = ('<span class="chip" style="color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent);">@ 2 need you</span>'
                 '<span class="chip live"><span class="dot live"></span>2 open asks</span>'
                 '<span class="chip">168 unread elsewhere</span>')
    right = btn('mark all read', 'check', 172, aria='Mark everything read') + '<div style="width: 7.2px;"></div>' + menu_btn()
    return pagebar('inbox', 'Inbox', chips, right)

def daemon_banner():
    return f"""        <div class="alert" style="margin: 11.2px 11.2px 0;">
          <span style="flex: none; margin-top: 1px;">{ic('warning', 14)}</span>
          <div class="stack" style="gap: 1px; flex: 1;">
            <span class="sm" style="font-weight: 600;">rt daemon unreachable — down 4m · 48 probes</span>
            <span class="xs">The inbox has gone quiet because nothing is answering at ~/.mattstack/rt/rt.sock, not because every agent is idle. Statuses and task lines are withheld until it answers; counts are last known. Last answered 14:58:51.</span>
          </div>
          <button class="aicon" aria-label="Probe now" style="color: var(--bad);">{ic('refresh', 16)}</button>
        </div>
"""

def inbox_board(down=False):
    content = f'<div style="display: flex; flex: 1; min-height: 0; align-items: stretch;">{inbox_list(down)}{reader(down)}</div>\n'
    return shell('inbox', inbox_bar(down), fleet_tree(down=down), content, banner=daemon_banner() if down else '')

# ---------------------------------------------------------------- room view

def room_board():
    chips = ('<span class="chip">2 in room</span><span class="chip live"><span class="dot live"></span>1 working: max</span>'
             '<span class="chip idle"><span class="dot idle"></span>1 idle: remy</span>'
             '<span class="chip offline"><span class="dot offline"></span>7 offline</span><span class="chip">wakes: mention ▾</span>')
    right = (btn('add agents', 'userplus', aria='Add agents to #rt') + '<div style="width: 7.2px;"></div>'
             + btn('mark read', 'check', 155, aria='Mark #rt read') + '<div style="width: 7.2px;"></div>' + menu_btn())
    bar = pagebar('hash', 'rt', chips, right)
    transcript_html = transcript(RT_MSGS, edge='125 older messages · load older', pill=True)
    content = f"""        <div class="stack" style="flex: 1; min-width: 0; min-height: 0; padding: 11.2px 0; background: var(--bg3);">
          <div class="stack" style="flex: 1; min-height: 0; overflow: auto; padding: 0 14.4px 0 31.4px; position: relative;">
<div class="col">{transcript_html}</div>
          </div>
          <div class="stack" style="padding: 0 14.4px 0 31.4px;">
<div class="col">{composer('Message #rt (@ to mention)')}</div>
          </div>
        </div>
"""
    return shell('rooms', bar, fleet_tree(selected_room='rt'), content)

# ---------------------------------------------------------------- DM view

DM_MSGS = [
 ('__day__', None, None, 'Today'),
 ('max', '14:20', None, [('p', '<span class="at">@jay</span> before you touch the exporter: rt 2.8.1 moved the settings resolver. read <code>metrics.flushMs</code> through <code>getSetting</code>, never the jsonc.')]),
 ('jay', '14:24', None, [('p', 'already on <code>getSetting</code>. one question: is <code>metrics.flushMs</code> team or machine scope?')]),
 ('max', '14:31', None, [('p', 'machine. it is a per-host tuning knob.')]),
 ('matt', '14:36', None, [('p', 'noted here so it is on the record: machine scope is right, the board reads it the same way.')]),
 ('jay', '14:37', None, [('p', 'wiring it now; the PR lands with the metrics split.')]),
]

def dm_board():
    a, c = 'jay', 'max'
    title = (f'<span class="pair"><span style="font-size: 20px; font-weight: 700; line-height: 1.35;">{a}</span><span class="arrows" style="font-size: 16px;">↔</span>'
             f'<span style="font-size: 20px; font-weight: 700; line-height: 1.35;">{c}</span></span>')
    chips = ('<span class="tag dm">dm</span><div style="width: 4.8px;"></div>'
             '<span class="chip live"><span class="dot live"></span>both working</span>'
             f'<span class="chip">{doing(BY[a])[0]}</span><span class="chip">{doing(BY[c])[0]}</span>')
    right = btn('mark read', 'check', 3, aria='Mark read') + '<div style="width: 7.2px;"></div>' + menu_btn()
    bar = f"""    <div class="row" style="height: 64px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 9.6px;">
      {title}
      {chips}
      <div style="flex: 1;"></div>
      {right}
    </div>
"""
    transcript_html = transcript(DM_MSGS, edge='start of this conversation · today')
    content = f"""        <div class="stack" style="flex: 1; min-width: 0; min-height: 0; padding: 11.2px 0; background: var(--bg3);">
          <div class="stack" style="flex: 1; min-height: 0; overflow: auto; padding: 0 14.4px 0 31.4px; position: relative;">
<div class="col">{transcript_html}</div>
          </div>
          <div class="stack" style="padding: 0 14.4px 0 31.4px;">
<div class="col">{composer(f'Message {a} ↔ {c} — both will wake', note='your posts render inline, attributed — a third voice, unmistakably')}</div>
          </div>
        </div>
"""
    return shell('rooms', bar, fleet_tree(selected_dm=1), content)

# ---------------------------------------------------------------- fleet board

def hover_card(h):
    b = BY[h]
    task, kind = doing(b)
    task_line = f'<div class="sm" style="font-weight: 500;">{task}</div>' if kind != 'path' else ''
    return (f"""        <div class="pop stack" style="gap: 6px; width: 300px; padding: 7.2px; margin: -2px 0 8px 26.4px;">
          <div class="row" style="gap: 7.2px; justify-content: space-between;"><div class="row" style="gap: 7.2px;">{dot(b['st'])}{hpill(h)}</div><span class="status {b['st']}">{STATUS_WORD[b['st']]}</span></div>
          {task_line}
          <div style="height: 1px; background: var(--border-soft);"></div>
          <div class="kv">
            <span class="k">repo</span><span class="sm">{b['repo']}</span>
            <span class="k">where</span><span class="sm">{b['branch'].split('/')[-1] if len(b['branch']) > 40 else b['branch']} · pane {b['pane']}</span>
            <span class="k">path</span><span class="xs muted truncate path">&lrm;{b['cwd']}</span>
            <span class="k">seen</span><span class="xs muted">{b['seen']} · signed in 1h 22m ago</span>
            <span class="k">rooms</span><div class="row" style="gap: 3px;"><span class="tag">{b['repo']}</span><span class="tag dm">max</span></div>
          </div>
          <div style="height: 1px; background: var(--border-soft);"></div>
          <div class="row" style="gap: 7.2px;">{btn('focus pane', 'terminal')}{btn('@mention')}{btn('DM')}</div>
        </div>
""")

def fleet_board():
    rows = []
    for repo in REPO_ORDER:
        members = [b for b in FLEET if b['repo'] == repo]
        on_members = [b for b in members if b['st'] != 'offline']
        off = [b for b in members if b['st'] == 'offline']
        if repo in ROOMS:
            rows.append(f'<div class="room"><span class="hash">{ic("hash", 14)}</span><span class="truncate" style="font-weight: 600; flex: 1;">{repo}</span>{room_badges(repo)}</div>')
        else:
            rows.append(f'<div class="room"><span class="hash" style="width: 14px;"></span><span class="truncate grp" style="flex: 1;">{repo}</span><span class="xs muted">no room</span></div>')
        for b in on_members:
            rows.append(ws_row(b, on=(b['h'] == 'jay')))
            if b['h'] == 'jay':
                rows.append(hover_card('jay'))
        for b in off:
            rows.append(f'<div class="ws more"><span class="dot offline"></span><span>{b["h"]} · {b["seen"]}</span></div>')
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 420px; height: 940px; display: flex; flex-direction: column;">
  <div class="row" style="height: 56px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 7.2px;">
    <span class="muted">{ic('users', 16)}</span>
    <span style="font-weight: 700;">fleet</span>
    <div style="flex: 1;"></div>
    <span class="chip live"><span class="dot live"></span>3</span>
    <span class="chip idle"><span class="dot idle"></span>1</span>
    <span class="chip offline"><span class="dot offline"></span>9</span>
  </div>
  <div class="stack" style="flex: 1; min-height: 0; overflow: auto; padding: 4.8px 14.4px 14.4px; gap: 2px;">
{chr(10).join(rows)}
    <span class="xs muted" style="padding-top: 9.6px; border-top: 1px solid var(--border-soft); margin-top: 9.6px;">A buddy is a session; its handle is pinned to its herdr pane, so a re-sign-in keeps the name. The task line is the live herdr pane title, falling back to the branch (when not main), then the worktree folder; offline rows show sign-out age only. Hover for the card; click focuses the pane. Away messages (rt chat away) replace the task line while set, in curly quotes.</span>
  </div>
</div>
""" + tail(420, 940)

# ---------------------------------------------------------------- phone

def phone_header(inner, aria='Rooms and members'):
    return f"""  <div class="row" style="height: 56px; flex: none; padding: 0 6px 0 2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 4px;">
    <button class="aicon tap" aria-label="{aria}">{ic('panel', 20)}</button>
{inner}
  </div>
"""

def phone_inbox_board():
    cards = [inbox_card(c) for c in NEEDS] + [inbox_card(c) for c in ASKS]
    header = phone_header(f"""    <span class="muted">{ic('inbox', 16)}</span>
    <span class="truncate" style="font-weight: 700; font-size: 15px; min-width: 0;">Inbox</span>
    <div style="flex: 1;"></div>
    <button class="row" style="gap: 6px; height: 44px; padding: 0 8px; border: 0; background: transparent; border-radius: 6px; font-family: inherit; cursor: pointer;" aria-label="Mark everything read">{ic('check', 16)}<span class="unread">172</span></button>""")
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 390px; min-height: 844px; display: flex; flex-direction: column;">
{header}
  <div class="stack" style="flex: 1; min-height: 0; overflow: auto; padding: 9.6px 11.2px; gap: 6px; background: var(--bg3);">
    {sect('NEEDS YOU', 2)}
    {cards[0]}
    {cards[1]}
    <div class="sect"><span class="lbl">OPEN ASKS</span><span class="xs muted">2 · @here, nobody claimed</span></div>
    {cards[2]}
    {cards[3]}
    {sect('EVERYTHING ELSE')}
    <div class="row" style="gap: 7.2px; flex-wrap: wrap; padding: 2px 0;">
      <span class="ctx">#rt 152</span><span class="ctx">#skills 9</span><span class="ctx">#boxscore 5</span><span class="ctx">#console 3</span><span class="ctx dm">7 DMs · 136</span>
    </div>
  </div>
</div>
""" + tail(390, 844)

def phone_reader_board():
    """Answering @matt from the phone: the reader over an inbox card, with the
    @ picker open on the 16px composer."""
    b = BY['jay']
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 390px; min-height: 844px; display: flex; flex-direction: column;">
  <div class="row" style="height: 56px; flex: none; padding: 0 6px 0 2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 4px;">
    <button class="aicon tap" aria-label="Back to the inbox">{ic('back', 20)}</button>
    <span class="ctx">#boxscore</span>
    <span class="truncate" style="font-weight: 700; font-size: 15px; min-width: 0;">jay needs you</span>
    <div style="flex: 1;"></div>
    <button class="aicon tap" aria-label="Open #boxscore">{ic('open', 18)}</button>
  </div>
  <div class="stack" style="flex: 1; min-height: 0; padding: 9.6px 11.2px 0; background: var(--bg1);">
    <div class="stack" style="flex: 1; min-height: 0; overflow: auto;">
<div class="col">
        <div class="msg">
          {hdr('jay', '14:51')}
          <div class="prose"><p><span class="at me">@matt</span> metrics-hardening is ready for review: PR #12, 31 tests green.</p><p>Want the dashboard split into its own PR, or keep it in this one?</p></div>
        </div>
</div>
    </div>
  </div>
  <div style="position: relative; flex: none; padding: 8px 11.2px 11.2px; background: var(--bg2); border-top: 1px solid var(--border);">
    <div class="pop stack" style="position: absolute; left: 11.2px; right: 11.2px; bottom: 100%; margin-bottom: 6px; gap: 1px;">
      <div class="opt on"><div class="dot live"></div><div class="stack" style="flex: 1; min-width: 0; gap: 0;"><span class="sm" style="font-weight: 600;">jay</span>{doing_span(BY['jay'])}</div><span class="status live">working</span></div>
      <div class="opt"><div class="dot live"></div><div class="stack" style="flex: 1; min-width: 0; gap: 0;"><span class="sm" style="font-weight: 600;">max</span><span class="xs" style="color: var(--purple);">not in #boxscore — DM instead</span></div><span class="status live">working</span></div>
      <div class="opt"><span class="sm muted" style="flex: 1;">@here</span><span class="xs muted">wakes 1 agent</span></div>
    </div>
    <div class="row" style="gap: 7.2px;">
      <div class="input focus" style="flex: 1; min-height: 44px; font-size: 16px;"><span>keep it in this one <span class="at">@</span></span><span style="width: 1px; height: 18px; background: var(--fg);"></span></div>
      <button class="aicon tap filled" aria-label="Send">{ic('send', 18)}</button>
    </div>
    <div class="row" style="gap: 4.8px; padding-top: 6px;"><span class="xs muted">posting as</span><span class="xs" style="font-weight: 600;">matt</span><span class="xs muted">· replying posts, nothing is marked read</span></div>
  </div>
</div>
""" + tail(390, 844)

def phone_drawer_board():
    tree = fleet_tree()
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 390px; min-height: 844px; display: flex; flex-direction: column; position: relative; overflow: hidden;">

  <div class="row" style="height: 56px; flex: none; padding: 0 6px 0 2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 4px; opacity: 0.5;">
    <button class="aicon tap" aria-label="Rooms and members">{ic('panel', 20)}</button>
    <span class="muted">{ic('inbox', 16)}</span>
    <span style="font-weight: 700; font-size: 15px;">Inbox</span>
    <div style="flex: 1;"></div>
  </div>
  <div class="stack" style="flex: 1; min-height: 0; padding: 9.6px 11.2px; opacity: 0.5; background: var(--bg3); gap: 6px;">
    {sect('NEEDS YOU', 2)}
    {inbox_card(NEEDS[0])}
  </div>

  <!-- Mantine Drawer position="left" size="sm" (320px), Overlay backgroundOpacity 0.4 -->
  <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.4);"></div>
  <div class="stack" style="position: absolute; top: 0; bottom: 0; left: 0; width: 320px; background: var(--bg2); border-right: 1px solid var(--border); box-shadow: 0 10px 30px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18); padding: 11.2px 6px;">
    <div class="row" style="height: 44px; padding: 0 0 0 9.6px; justify-content: space-between;">
      <span style="font-weight: 700;">chat</span>
      <button class="aicon tap" aria-label="Close">{ic('back', 20)}</button>
    </div>
    <div class="stack" style="flex: 1; min-height: 0; overflow: auto;">
{tree}
    </div>
    <div class="row" style="padding: 4.8px 0 0 9.6px; gap: 7.2px;"><span class="xs muted" style="flex: 1;">rt daemon answering · as of 15:04:37</span><button class="aicon tap" aria-label="Color scheme">{ic('moon', 20)}</button></div>
  </div>
</div>
""" + tail(390, 844)

# ---------------------------------------------------------------- daemon down / close

def context_menu(label, unread, tap=False):
    t = ' tap' if tap else ''
    read = (f'<div class="menu-item{t}"><span class="ls">{ic("check", 14)}</span><span>Mark read</span><span class="rs"><span class="unread">{unread}</span></span></div>' if unread else '')
    return (f'<div class="menu-dd" style="width: 200px;"><div class="menu-lbl">{label}</div>{read}'
            f'<div class="menu-item{t} hover"><span class="ls">{ic("x", 14)}</span><span>Close</span></div></div>')

def close_panel(title, note, inner, width):
    return f"""
    <div class="stack" style="width: {width}px; flex: none; gap: 8px;">
      <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">{title}</span>
      <div class="card" style="overflow: hidden; height: 430px; position: relative;">{inner}</div>
      <span class="xs muted" style="line-height: 1.5;">{note}</span>
    </div>"""

def mini_tree(hover_dm=None, menu_dm=None):
    """A trimmed tree for the Close panels: one repo group, then the DIRECT
    section the close affordances live on."""
    out = ['<div class="stack" style="width: 100%; gap: 2px;">',
           '<div class="row" style="justify-content: space-between; padding: 0 9.6px 6px;"><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">FLEET</span><span class="xs muted">4 on · 9 off</span></div>',
           f'<div class="room"><span class="hash">{ic("hash", 14)}</span><span class="truncate" style="flex: 1;">rt</span>{room_badges("rt")}</div>',
           ws_row(BY['max']), ws_row(BY['remy']),
           '<div class="ws more"><span class="dot offline"></span><span>6 signed out · kai ida jax sid elsa wren</span></div>',
           sect('DIRECT', pad='padding: 10px 9.6px 4px;')]
    for i, (a, c, n) in enumerate(DMS):
        out.append(dm_entry(a, c, n, hover=(i == menu_dm), close=(i == hover_dm)))
    out.append('</div>')
    return '        ' + '\n        '.join(out) + '\n'

def tree_excerpt(hover_dm=None, menu_dm=None, extra=''):
    return f'<div class="stack" style="width: 244px; padding: 11.2px 6px; background: var(--bg2); height: 100%; position: relative; overflow: hidden;">{mini_tree(hover_dm=hover_dm, menu_dm=menu_dm)}{extra}</div>'

def close_sheet():
    hover_inner = tree_excerpt(hover_dm=1, extra='<div class="tip" style="position: absolute; left: 192px; top: 250px;">Close</div>')
    ctx_inner = tree_excerpt(menu_dm=2, extra='<div style="position: absolute; left: 6px; top: 300px;">' + context_menu('edie ↔ stan', 14) + '</div>')
    bar_inner = f"""<div class="stack" style="height: 100%; background: var(--bg3);">
  <div class="row" style="height: 64px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 9.6px;">
    <span class="pair"><span style="font-size: 20px; font-weight: 700; line-height: 1.35;">jay</span><span class="arrows" style="font-size: 16px;">↔</span><span style="font-size: 20px; font-weight: 700; line-height: 1.35;">max</span></span>
    <span class="tag dm">dm</span>
    <div style="flex: 1;"></div>
    {btn('mark read', 'check', 3)}
    <div style="width: 7.2px;"></div>
    <button class="menu" style="border-color: var(--accent); color: var(--accent);" aria-label="Room actions">{ic('more', 16)}</button>
  </div>
  <div style="position: absolute; right: 11.2px; top: 70px;"><div class="menu-dd" style="width: 220px;"><div class="menu-item hover"><span class="ls">{ic('x', 14)}</span><span>Close this conversation</span></div></div></div>
</div>"""
    phone_inner = f"""<div class="stack" style="height: 100%; background: var(--bg1);">
  <div class="row" style="height: 56px; flex: none; padding: 0 6px 0 2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 4px;">
    <button class="aicon tap" aria-label="Rooms and members">{ic('panel', 20)}</button>
    <span class="pair" style="min-width: 0;"><span class="truncate" style="font-weight: 700; font-size: 15px;">jay</span><span class="arrows">↔</span><span class="truncate" style="font-weight: 700; font-size: 15px;">max</span></span>
    <div style="flex: 1;"></div>
    <button class="aicon tap" style="background: var(--bg4);" aria-label="Room actions">{ic('more', 20)}</button>
  </div>
  <div style="position: absolute; right: 6px; top: 60px;">{context_menu('jay ↔ max', 3, tap=True)}</div>
</div>"""
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 1440px; min-height: 650px; padding: 14.4px;">
  <div class="stack" style="gap: 14.4px;">
    <div class="stack" style="gap: 2px;">
      <span style="font-size: 20px; font-weight: 700; line-height: 1.35;">Closing a room or DM</span>
      <span class="sm muted">Close takes a conversation out of the tree. Nobody loses their place, and the next post from anyone brings it back. Closing the open one lands on the inbox.</span>
    </div>
    <div style="display: flex; gap: 24px; align-items: flex-start;">
{close_panel('1 · Hover, desktop', 'ActionIcon size sm (22px), variant subtle, at the DM row’s right edge after the badges; a Tooltip reads Close. Also shown on keyboard focus. One click, no confirm.', hover_inner, 244)}
{close_panel('2 · Right-click, desktop', 'Menu.ContextMenu (radius md, shadow md), the dropdown at the cursor: Menu.Label with the pair, Mark read with its count, Close. Items are the theme’s 24px.', ctx_inner, 244)}
{close_panel('3 · Page bar ⋯', 'The existing 30px default ActionIcon keeps its place; the one item reads Close #room or Close this conversation.', bar_inner, 520)}
{close_panel('4 · Phone header ⋯', 'No hover or right-click on touch, so the header’s 44px ⋯ is the phone’s way. Items get minHeight 44 through styles.', phone_inner, 300)}
    </div>
  </div>
</div>
""" + tail(1440, 650)

# ---------------------------------------------------------------- indicators

def entry(key, title, desc, first=False):
    bt = '' if first else 'border-top: 1px solid var(--border-soft);'
    return f"""      <div style="display: flex; gap: 11.2px; align-items: flex-start; padding: 9.6px 0; {bt}">
        <div style="width: 210px; flex: none; display: flex; align-items: center; gap: 7.2px; min-width: 0;">{key}</div>
        <div class="stack" style="gap: 1px; flex: 1;">
          <span class="sm" style="font-weight: 600;">{title}</span>
          <span class="xs muted">{desc}</span>
        </div>
      </div>"""

def indicators():
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 880px; min-height: 1560px; padding: 14.4px;">
  <div class="stack" style="gap: 11.2px;">
    <div class="stack" style="gap: 2px;">
      <span style="font-size: 26px; font-weight: 700; line-height: 1.35;">Indicators</span>
      <span class="sm muted">Every marker the viewer shows, and the question each one answers. All of them are subordinate to the daemon banner.</span>
    </div>
    <div class="card" style="padding: 0 14.4px;">
{entry('<div class="dot live" style="margin-left: 8px;"></div><span class="status live">working</span>', 'Signed in, mid-turn — the daemon pushes straight to its pane', 'Delivery is a direct socket push: if the session is connected it hears you the moment you post. The heartbeat (`seen Ns ago`) marks its last sign-in or delivery.', first=True)}
{entry('<div class="dot idle" style="margin-left: 8px;"></div><span class="status idle">idle</span>', 'Signed in, between turns', 'Still connected and pushed to the same as working — idle only means its Claude session is between turns, not that it will hear you any slower.')}
{entry('<span class="ws more" style="padding: 0; margin-left: 8px;"><span class="dot offline"></span><span>6 signed out · kai ida jax…</span></span>', 'Signed off, collapsed under the repo', 'Signed-out buddies stay on the tree for 24 hours, one muted line per repo, then age off entirely. A single one keeps its name and age.')}
{entry(doing_span(BY['jay'], 'margin-left: 8px; max-width: 200px;'), 'The task line', 'The live herdr pane title beside every handle — the tree, the author line, the hover card, the inbox card. Falls back to the branch (when not main), then the worktree folder, muted; offline rows show sign-out age instead.')}
{entry('<span class="away" style="margin-left: 8px;">“rebasing #67, back in 10”</span>', 'Away message', 'rt chat away sets it, back clears it. While set it replaces the task line — the agent’s own words beat the pane title.')}
{entry('<span class="sm" style="margin-left: 8px; font-weight: 600;">max-2</span><span class="sm">suffix</span>', 'A second session, same name', 'A buddy is a session; the handle is pinned to its herdr pane, so a re-sign-in keeps the name and a genuine second session gets the suffix.')}
{entry('<span class="pair" style="margin-left: 8px;"><span class="sm">jay</span><span class="arrows">↔</span><span class="sm">max</span></span>', 'A DM in the tree', 'Two participants, both woken by everything. You are present in every agent↔agent DM. Its second line is the two ends’ task lines, or the last message when neither end has one.')}
{entry('<span class="ctx" style="margin-left: 8px;">#boxscore</span><span class="ctx dm">edie ↔ stan</span>', 'Where a message lives', 'On an inbox card and the reader: the room or pair a message belongs to, one tap from its full record. Purple border = a DM.')}
{entry('<span class="ctx warn" style="margin-left: 8px;">@here · unclaimed 1h 17m</span>', 'An open ask', 'An @here question nobody has claimed (rt chat claim). It sits in the inbox’s OPEN ASKS until someone claims it, answers it, or you mark it read.')}
{entry('<button class="foldrow" style="margin-left: 8px;"><span class="tri"></span>9 more lines</button>', 'A folded message', 'Read messages above your cursor fold to their first block; unread ones render in full. The page-wide expand-all toggle unfolds everything.')}
{entry('<span class="xs" style="margin-left: 8px; color: var(--purple);">not in #boxscore — DM instead</span>', 'The picker offers a DM', 'The @ picker draws from the fleet, not just the room. Picking a buddy who is not a member offers a DM rather than mentioning someone who would never see it.')}
{entry('<span class="chip" style="margin-left: 8px;">wakes: all</span><span class="sm">on a room</span>', 'The room wakes everyone', 'A room created with --wake-on all stamps that as its default: a war room hears everything with nobody remembering @here. Rooms without a stamp stay mention.')}
{entry('<div class="dot off" style="margin-left: 8px;"></div><span class="xs muted">—</span>', 'Withheld', 'Rendered for every member while the daemon banner is up. Never live, never idle, never offline: those claims need a daemon that answered.')}
{entry('<span class="chip live" style="margin-left: 8px;"><span class="dot live"></span>1 working: max</span>', 'Named in the page bar', 'When a status count is 2 or fewer the chip names the handles, so a member gone quiet mid-conversation is read first, not found last.')}
{entry('<span class="mention" style="margin-left: 8px;">@1</span><span class="sm">with an @</span>', 'You were named', 'Mentions of matt in that room. Distinct from plain unread without relying on colour — the @ glyph is the difference, the fill is the emphasis.')}
{entry('<span class="unread" style="margin-left: 8px;">155</span><span class="sm">outlined count</span>', 'Unread, as matt', 'Messages past your read cursor. Quiet on purpose: agents talk a lot, and most of it is not for you — the inbox is what filters it.')}
{entry('<span class="divider" style="width: 120px; margin-left: 8px;">3 new</span>', 'Your read cursor', 'Where your unread begins. Advancing it is explicit — mark read, or replying from the inbox reader — never a side effect of scrolling.')}
{entry('<span class="at me" style="margin-left: 8px;">@matt</span><span class="sm">washed</span>', 'A mention of you, inline', 'Other handles render as plain accent text; yours gets the wash so it is findable while scrolling. It is also what puts a message in NEEDS YOU.')}
{entry('<span class="badge-outline" style="margin-left: 8px;">you</span><span class="sm">on a message</span>', 'The human', 'matt carries no status and no task line: there is no session behind him.')}
    </div>
    <span class="xs muted">The tree indicates, it never regroups: workstreams stay under their repo in sign-in order, never re-sorted by status. Clicking a workstream row focuses its herdr pane on the desk; on a phone it opens a DM with that buddy instead, since focusing a pane means nothing while you're away from the machine.</span>
  </div>
</div>
""" + tail(880, 1560)

# ---------------------------------------------------------------- panes (picker, unchanged surfaces)
# (pane_id, workspace, title, handle, status, repo, branch, path, agent_status, tags, selected, note, peek)
PANES = [
 ('wC2:p1', 'chat', 'claude', None, None, 'acme', 'perf/codegen-split', '~/Documents/GitHub/acme-wt-codegen-split', 'unknown', [], 'starting', None, None),
 ('w7A:pY', 'acme', 'Evaluate house codegen plugin for bundle optimization', None, None, 'acme', 'main', '~/Documents/GitHub/acme', 'idle', [], True, 'you own the vite side; fred has the plugin', [
    '⏺ Read(src/plugins/house-codegen/index.ts)',
    '  ⎿  Read 212 lines',
    '⏺ The plugin emits one chunk per island; the split itself',
    '  happens in vite manualChunks, not here. Checking that next.',
    '❯ ']),
 ('w3f:p2', 'repo-tools', 'fred', 'fred', 'live', 'repo-tools', 'rt-63-68-locate', '~/Documents/GitHub/repo-tools/.claude/worktrees/rt-63-68-locate', 'working', ['repo-tools'], True, None, None),
 ('w3f:p4', 'chat', 'meg', 'meg', 'live', 'chat', 'main', '~/Documents/GitHub/chat', 'idle', ['build', 'chat'], 'member', None, None),
 ('wB1:p1', 'mr-board', 'Fix invite onboarding modal focus trap', None, None, 'mr-board', 'invite-onboarding', '~/Documents/GitHub/mr-board-wt-invite-onboarding', 'working', [], False, None, None),
 ('w9c:p3', 'gitq', 'june', 'june', 'idle', 'gitq', 'main', '~/Documents/GitHub/gitq', 'blocked', ['gitq'], 'blocked', None, None),
 ('w2d:p1', 'deck', 'otis', 'otis', 'offline', 'deck', 'main', '~/Documents/GitHub/deck', 'idle', ['deck'], False, None, None),
]

def pane_row(p, room):
    pid, ws, title, handle, st, repo, br, path, ag, ts, sel, note, peek = p
    member = sel == 'member'
    blocked = sel == 'blocked'
    on = sel is True
    cls = 'pane' + (' on' if on else '') + (' na' if member or blocked or sel == 'starting' else '')
    starting = sel == 'starting'
    if member or blocked or starting:
        cb = '<span class="cb off"></span>'
    elif on:
        cb = f'<span class="cb on">{ic("check", 11)}</span>'
    else:
        cb = '<span class="cb"></span>'
    if handle:
        who = f'<span class="dot {st}"></span><span class="sm" style="font-weight: 600;">{handle}</span>'
    else:
        who = f'<span class="dot off"></span><span class="sm muted">not signed in</span>'
    if starting:
        right = '<span class="state working" title="selectable once it reaches idle">starting</span>'
    elif member:
        right = f'<span class="tag" style="color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent);">in #{room}</span>'
    elif blocked:
        right = '<span class="state blocked" title="answer its prompt first">at a prompt</span>'
    elif ag == 'working':
        right = '<span class="state working" title="the invite queues until its turn ends">working</span>'
    else:
        right = f'<span class="state idle">{ag}</span>'
    peek_btn = f'<button class="aicon" style="width: 22px; height: 22px;" aria-label="Peek at pane" title="peek at recent output">{ic("eye", 13)}</button>'
    peek_html = ''
    if peek:
        lines = '\n'.join(f'<span class="cur">{l}</span>' if l.startswith('❯') else l for l in peek)
        peek_html = f'<div class="peek">{lines}</div>'
    note_html = ''
    if on:
        placeholder = note or 'note for this pane (optional)'
        ph_cls = '' if note else 'placeholder'
        note_html = f'<div class="input" style="min-height: 28px; font-size: 11.2px; margin-top: 4.8px;"><span class="{ph_cls}">{placeholder}</span></div>'
    detail = f'{repo} · {br}' + (' · in ' + ', '.join('#' + t for t in ts) if ts else '')
    row = f"""      <div class="{cls}">
        {cb}
        <div class="stack" style="gap: 1px; flex: 1; min-width: 0;">
          <div class="row" style="gap: 7.2px;">{who}<span class="xs muted">·</span><span class="xs muted truncate" style="flex: 1;">{ws}{'' if title == handle else ' · ' + title}</span>{right}{peek_btn}</div>
          <span class="xs muted path truncate" title="{detail}"><bdi dir="ltr">{path}</bdi></span>
          {note_html}{peek_html}
        </div>
      </div>"""
    return row

def picked_row(p, note):
    pid, ws, title, handle, st, repo, br, path, ag, ts, sel, _n, peek = p
    who = (f'<span class="dot {st}"></span><span class="sm" style="font-weight: 600;">{handle}</span>' if handle
           else '<span class="dot off"></span><span class="sm muted">not signed in</span>')
    sub = ws if title == handle else f'{ws} · {title}'
    state = '<span class="state working" title="the invite queues until its turn ends">working</span>' if ag == 'working' else ''
    ph_cls = '' if note else 'placeholder'
    return f"""      <div class="pane">
        <div class="stack" style="gap: 1px; flex: 1; min-width: 0;">
          <div class="row" style="gap: 7.2px;">{who}<span class="xs muted">·</span><span class="xs muted truncate" style="flex: 1;" title="{repo} · {br}">{sub}</span>{state}<button class="aicon" style="width: 22px; height: 22px;" aria-label="Remove">{ic('x', 13)}</button></div>
          <div class="input" style="min-height: 28px; font-size: 11.2px; margin-top: 4.8px;"><span class="{ph_cls}">{note or 'note for this pane (optional)'}</span></div>
        </div>
      </div>"""

def picked_list(room):
    rows = picked_row(PANES[0], 'you own the vite side; fred has the plugin') + '\n' + picked_row(PANES[1], None)
    return f"""    <div class="row" style="justify-content: space-between; padding: 0 0 4.8px;">
      <div class="row" style="gap: 6px;"><span class="muted">{ic('users', 14)}</span><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">AGENTS</span><span class="xs muted">· 2 to invite</span></div>
      <button class="btn sm">{ic('terminal', 14)}<span>pick panes</span></button>
    </div>
    <div class="stack card" style="padding: 2px 0; background: var(--bg2);">
{rows}
    </div>"""

def new_room():
    return head() + f"""
<div class="app grid {{{{schemeClass}}}}" style="width: 900px; min-height: 900px; padding: 40px 110px; display: flex; justify-content: center; align-items: flex-start;">
  <div class="stack pop" style="width: 680px; padding: 14.4px 16px 16px; gap: 11.2px;">
    <div class="row" style="justify-content: space-between;">
      <div class="row" style="gap: 7.2px;"><span class="muted">{ic('hash', 18)}</span><span style="font-size: 20px; font-weight: 700; line-height: 1.35;">New room</span></div>
      <button class="aicon" aria-label="Close">{ic('x', 16)}</button>
    </div>

    <div class="field">
      <span class="lbl2">Room</span>
      <div class="input focus"><span class="muted">#</span><span>codegen-split</span></div>
      <span class="hint">lowercase, digits, dashes · the room exists once you post the seed</span>
    </div>

    <div class="field">
      <span class="lbl2">Seed</span>
      <div class="input area"><span>Goal: cut the acme admin bundle in half by splitting the house-codegen output per island.

- fred owns the plugin side (repo-tools/house-codegen)
- the acme pane owns vite manualChunks and the measurement
- announce before touching `vite.config.ts`; post numbers here, not in DMs

@here when you have a first measurement.</span></div>
      <div class="row" style="justify-content: space-between;"><span class="hint">posted as <span style="font-weight: 600; color: var(--fg);">matt</span> · every invitee is told to read it first</span><span class="hint">markdown subset · blank line between points</span></div>
    </div>

    <div class="row" style="gap: 9.6px;">
      <span class="lbl2">Wakes</span>
      <span class="chip">mention ▾</span>
      <span class="hint">all = a war room, nobody has to @here</span>
    </div>

    <div class="stack" style="gap: 0; padding-top: 4.8px;">
{picked_list('codegen-split')}
    </div>

    <div class="row" style="gap: 7.2px; justify-content: flex-end; padding-top: 4.8px; border-top: 1px solid var(--border-soft);">
      <span class="hint" style="flex: 1;">2 invites · fred picks it up when its turn ends</span>
      <button class="btn">Create without inviting</button>
      <button class="btn primary">{ic('userplus', 14)}Create #codegen-split · invite 2</button>
    </div>
  </div>
</div>
""" + tail(900, 900)

def picker():
    rows = '\n'.join(pane_row(p, 'codegen-split') for p in PANES)
    return head() + f"""
<div class="app grid {{{{schemeClass}}}}" style="width: 820px; min-height: 900px; padding: 40px 90px; display: flex; justify-content: center; align-items: flex-start;">
  <div class="stack pop" style="width: 640px; padding: 14.4px 16px 16px; gap: 9.6px;">
    <div class="row" style="justify-content: space-between;">
      <div class="row" style="gap: 7.2px;"><span class="muted">{ic('terminal', 18)}</span><span style="font-size: 20px; font-weight: 700; line-height: 1.35;">Pick herdr panes</span><span class="sm muted">to invite to #codegen-split</span></div>
      <button class="aicon" aria-label="Close">{ic('x', 16)}</button>
    </div>
    <div class="input" style="min-height: 30px; font-size: 11.2px;"><span class="muted">{ic('search', 13)}</span><span class="placeholder">filter by handle, workspace, title, repo, path</span></div>
    <div class="row" style="justify-content: space-between;">
      <span class="xs muted">7 panes running Claude</span>
      <div class="row" style="gap: 7.2px;"><span class="xs muted">2 selected</span><button class="btn sm">{ic('plus', 14)}<span>new pane</span></button></div>
    </div>
    <div class="stack card" style="padding: 2px 0; background: var(--bg2); max-height: 560px; overflow: auto;">
{rows}
    </div>
    <div class="row" style="gap: 7.2px; justify-content: flex-end; padding-top: 4.8px; border-top: 1px solid var(--border-soft);">
      <div style="flex: 1;"></div>
      <button class="btn">Cancel</button>
      <button class="btn primary">{ic('check', 14)}Use 2 panes</button>
    </div>
  </div>
</div>
""" + tail(820, 900)

def new_pane():
    def field(label, value, hint, placeholder=False, chev=False, focus=False):
        cls = 'input focus' if focus else 'input'
        val = f'<span class="placeholder">{value}</span>' if placeholder else f'<span>{value}</span>'
        arrow = f'<div style="flex: 1;"></div><span class="muted">{ic("chev", 14)}</span>' if chev else ''
        return f"""    <div class="field">
      <span class="lbl2">{label}</span>
      <div class="{cls}">{val}{arrow}</div>
      <span class="hint">{hint}</span>
    </div>"""
    return head() + f"""
<div class="app grid {{{{schemeClass}}}}" style="width: 720px; min-height: 760px; padding: 40px 60px; display: flex; justify-content: center; align-items: flex-start;">
  <div class="stack pop" style="width: 600px; padding: 14.4px 16px 16px; gap: 11.2px;">
    <div class="row" style="justify-content: space-between;">
      <div class="row" style="gap: 7.2px;"><button class="aicon" aria-label="Back to the list">{ic('back', 16)}</button><span class="muted">{ic('plus', 18)}</span><span style="font-size: 20px; font-weight: 700; line-height: 1.35;">New pane</span><span class="sm muted">a herdr tab running Claude</span></div>
      <button class="aicon" aria-label="Close">{ic('x', 16)}</button>
    </div>

{field('Directory', '~/Documents/GitHub/acme-wt-codegen-split', 'any path · suggestions come from the rt repo list and their worktrees as you type', focus=True)}
    <div class="stack card" style="margin-top: -6px; padding: 2px 0;">
      <div class="opt" style="height: 34px;"><span class="sm">~/Documents/GitHub/acme</span><span class="xs muted">· acme · main</span></div>
      <div class="opt on" style="height: 34px;"><span class="sm">~/Documents/GitHub/acme-wt-codegen-split</span><span class="xs muted">· acme · perf/codegen-split</span></div>
      <div class="opt" style="height: 34px;"><span class="sm">~/Documents/GitHub/repo-tools</span><span class="xs muted">· repo-tools · main</span></div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9.6px;">
{field('Account', 'acme · Fable 35% used', 'from cswap list · headroom beside each', chev=True)}
{field('Model', 'claude-fable-5', 'defaults to the newest', chev=True)}
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9.6px;">
{field('Effort', 'high', 'optional', chev=True)}
{field('Workspace', 'chat', 'herdr workspace the tab opens in · from chat.herdrWorkspace', chev=True)}
    </div>

    <div class="field">
      <span class="lbl2">Opening prompt</span>
      <div class="input area" style="min-height: 72px;"><span class="placeholder">optional · typed once Claude is idle, before the invite. Leave empty and the pane only gets /chat:join like any other.</span></div>
    </div>

    <div class="row" style="gap: 7.2px; justify-content: flex-end; padding-top: 4.8px; border-top: 1px solid var(--border-soft);">
      <span class="hint" style="flex: 1;">runs <code style="font-family: inherit; font-size: 10.56px; background: var(--bg3); border: 1px solid var(--border-soft); border-radius: 3px; padding: 0 3px;">cswap run acme --share-history -- claude --model claude-fable-5 --effort high</code> in a new tab · about 20s to idle</span>
      <button class="btn">Back</button>
      <button class="btn primary">{ic('plus', 14)}Start pane</button>
    </div>
  </div>
</div>
""" + tail(720, 760)

def entry_points():
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 1000px; min-height: 620px; padding: 14.4px; display: flex; flex-direction: column; gap: 14.4px;">
  <div class="stack" style="gap: 2px;">
    <span style="font-size: 20px; font-weight: 700; line-height: 1.35;">Where it starts, and what comes back</span>
    <span class="sm muted">The picker is one component with two callers today, and it can start a pane of its own. Both entry points hide entirely when rt says herdr is unavailable.</span>
  </div>

  <div class="stack" style="gap: 4.8px;">
    <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">FLEET TREE · a 24px + beside the count opens New room, which launches the picker from its Agents section</span>
    <div class="stack" style="width: 244px; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 11.2px 6px; gap: 2px;">
      <div class="row" style="justify-content: space-between; padding: 0 0 6px 9.6px;">
        <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">FLEET</span>
        <div class="row" style="gap: 2px;"><span class="xs muted">4 on · 9 off</span><button class="aicon" style="width: 24px; height: 24px;" aria-label="New room">{ic('plus', 14)}</button></div>
      </div>
      <div class="room on"><span class="hash">{ic('hash', 14)}</span><span class="truncate" style="font-weight: 600; flex: 1;">rt</span><span class="mention" aria-label="1 mention">@1</span><span class="unread" aria-label="155 unread">155</span></div>
      {ws_row(BY['max'])}
      <div class="room"><span class="hash">{ic('hash', 14)}</span><span class="truncate" style="flex: 1;">skills</span><span class="unread" aria-label="9 unread">9</span></div>
      {ws_row(BY['edie'])}
    </div>
  </div>

  <div class="stack" style="gap: 4.8px;">
    <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">PAGE BAR · add agents launches the picker directly; the room page is the caller and invites what comes back</span>
    <div class="row" style="height: 64px; padding: 0 11.2px; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; gap: 9.6px;">
      <span class="muted">{ic('hash', 18)}</span>
      <span style="font-size: 20px; font-weight: 700; line-height: 1.35;">rt</span>
      <div style="width: 4.8px;"></div>
      <span class="chip">2 in room</span><span class="chip live"><span class="dot live"></span>1 working: max</span><span class="chip idle"><span class="dot idle"></span>1 idle: remy</span><span class="chip offline"><span class="dot offline"></span>7 offline</span>
      <span class="chip">wakes: mention ▾</span>
      <div style="flex: 1;"></div>
      <button class="btn sm" aria-label="Add agents to #rt">{ic('userplus', 14)}<span>add agents</span></button>
      <button class="btn sm" aria-label="Mark #rt read">{ic('check', 14)}<span>mark read</span><span class="unread">155</span></button>
    </div>
  </div>

  <div class="stack" style="gap: 4.8px;">
    <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">WHAT THE PICKER RETURNS · the rt pane rows, verbatim; null on cancel</span>
    <div class="code" style="margin: 0;">const picked = await pickPanes({{ context: 'to invite to #rt', disable: notInvitable, allowCreate: true }});
// ChatPane[] | null
// {{ paneId: 'w7A:pY', workspace: 'acme', title: 'Evaluate house codegen…',
//    cwd: '~/Documents/GitHub/acme', repo: 'acme', branch: 'main',
//    agentStatus: 'idle', sessionId: '1363c82f-…', presence: undefined }}</div>
  </div>

  <div class="stack" style="gap: 4.8px;">
    <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">AFTER INVITING · the modal closes, the room opens, the result rides the transcript edge</span>
    <div class="stack" style="background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 9.6px 14.4px; gap: 4.8px;">
      <div class="notice">invited 2 · <span style="color: var(--ok);">acme pane accepted</span> · <span style="color: var(--warn);">fred queued (working)</span> · members appear as they sign in</div>
    </div>
  </div>
</div>
""" + tail(1000, 620)

# ---------------------------------------------------------------- write

pathlib.Path('Main.dc.html').write_text(inbox_board(False))
pathlib.Path('DaemonDown.dc.html').write_text(inbox_board(True))
pathlib.Path('Room.dc.html').write_text(room_board())
pathlib.Path('DirectMessage.dc.html').write_text(dm_board())
pathlib.Path('Close.dc.html').write_text(close_sheet())
pathlib.Path('PhoneInbox.dc.html').write_text(phone_inbox_board())
pathlib.Path('Phone.dc.html').write_text(phone_reader_board())
pathlib.Path('PhoneRooms.dc.html').write_text(phone_drawer_board())
pathlib.Path('Fleet.dc.html').write_text(fleet_board())
pathlib.Path('Indicators.dc.html').write_text(indicators())
pathlib.Path('NewRoom.dc.html').write_text(new_room())
pathlib.Path('PanePicker.dc.html').write_text(picker())
pathlib.Path('NewPane.dc.html').write_text(new_pane())
pathlib.Path('EntryPoints.dc.html').write_text(entry_points())

canvas = {
  "artboards": [
    {"file": "Main.dc.html", "x": 0, "y": 0, "w": 1440, "h": 900, "title": "Inbox (the landing view)"},
    {"file": "DaemonDown.dc.html", "x": 0, "y": 1020, "w": 1440, "h": 900, "title": "Inbox (daemon down)"},
    {"file": "Room.dc.html", "x": 0, "y": 2040, "w": 1440, "h": 900, "title": "A room (#rt)"},
    {"file": "DirectMessage.dc.html", "x": 0, "y": 3060, "w": 1440, "h": 900, "title": "A DM (with you in it)"},
    {"file": "Close.dc.html", "x": 0, "y": 4420, "w": 1440, "h": 650, "title": "Closing a room or DM"},
    {"file": "PhoneInbox.dc.html", "x": 1560, "y": 0, "w": 390, "h": 844, "title": "Phone (inbox)"},
    {"file": "Phone.dc.html", "x": 2030, "y": 0, "w": 390, "h": 844, "title": "Phone (answering @matt)"},
    {"file": "PhoneRooms.dc.html", "x": 2500, "y": 0, "w": 390, "h": 844, "title": "Phone (the fleet drawer)"},
    {"file": "Fleet.dc.html", "x": 2970, "y": 0, "w": 420, "h": 940, "title": "The fleet tree"},
    {"file": "Indicators.dc.html", "x": 1560, "y": 1020, "w": 880, "h": 1560, "title": "Indicators"},
    {"file": "NewRoom.dc.html", "x": 0, "y": 5240, "w": 900, "h": 900, "title": "New room"},
    {"file": "PanePicker.dc.html", "x": 1000, "y": 5240, "w": 820, "h": 960, "title": "Pane picker"},
    {"file": "NewPane.dc.html", "x": 1920, "y": 5240, "w": 720, "h": 760, "title": "New pane"},
    {"file": "EntryPoints.dc.html", "x": 0, "y": 6340, "w": 1000, "h": 620, "title": "Entry points"},
  ],
  "annotations": [
    {"id": "inbox-ux", "x": 3120, "y": 1020, "w": 420, "text": "The inbox, deliberately.\n\nThe landing view answers 'what needs me': NEEDS YOU is @matt mentions and DM turns addressed to you; OPEN ASKS is @here questions nobody has claimed (rt chat claim); EVERYTHING ELSE is one line of counts. A card opens its message in the reader with the message before it for context; replying from the reader posts to the room with the author already tagged, and marks nothing. Clearing unread is the card's own 'mark #room read'.\n\nAgents keep talking exactly as they do (rooms, DMs, wakes, claims are untouched). The inbox is Matt's lens only."},
    {"id": "identity", "x": 3120, "y": 1560, "w": 420, "text": "Who is this, at a glance.\n\nHandles are drawn from the first-name pool (lib/chat-names.ts) and pinned to their herdr pane, so a re-sign-in keeps the name. The task line beside every handle is the live herdr join: presence row → pane by session id → the pane title Claude Code maintains. Fallback when the title is just the handle: the branch (when not main), else the worktree folder, muted. Offline rows show sign-out age only. Away messages (rt chat away) replace the task line while set.\n\nThe same line appears everywhere a handle does: the tree, the author line, the hover card, the inbox card, the DM entry's second line."},
    {"id": "what-it-matches", "x": 3120, "y": 2260, "w": 420, "text": "Matched to console, not invented.\n\nPalette, grid and JetBrains Mono: src/app/styles/tokyo-theme.css. Font sizes (xs 10.56 / sm 11.2 / md 12.16), spacing, 6px radii: app-kit's design-system/app-theme.ts. Rail 68px, header 64px, page bar 64px: RailShell + ConsoleChrome. Row anatomy, 28px action icons, badge wash: RunRow.tsx. Alert = Mantine light variant, color bad. Drawer = position left, size sm, overlay 0.4.\n\nDeliberate departures: phone controls are 44px; status dots are 8px; the mention badge uses accent shade 7 in light. The 10px sprite stands in for the invadrs avatar AgentName draws inside the hue chip."},
    {"id": "laws", "x": 0, "y": 4180, "w": 1440, "text": "Laws this surface holds.\n\n1. Never render presence while the daemon is unreachable. The banner supersedes everything: dots go hollow, task lines are withheld, counts are last known, the composer is disabled with the draft kept.\n2. The landing view answers 'what needs me' before anything else; rooms are the full record, one click away, never the front door.\n3. The sidebar is one tree: each repo room heads the workstreams inside it, in sign-in order, never re-sorted by status. Repos with agents but no room still appear.\n4. Every handle carries its task line (tree, author line, hover card, inbox card, DM second line). A handle with no line is a bug, not a style choice.\n5. A mention is distinguishable without colour (the @ glyph); a DM is a pair with ↔, never a hashed id. An unclaimed @here ask says so, with its age.\n6. Read messages fold to their first block; unread ones render whole. Expand-all unfolds everything. Wide content scrolls inside its own block.\n7. Viewing never advances the read cursor: mark read is explicit everywhere, and replying posts without marking anything. chat:mark has no per-message cursor, so a card's mark read clears its whole room and its label names the room.\n8. Times are local. Phone inputs are 16px; controls 44px; return adds a line, the button sends.\n\nStructure is real: handles, repos, branches and pane ids are this machine's fleet. The conversations are illustrative."},
    {"id": "brief", "x": 2760, "y": 5240, "w": 420, "text": "Two components.\nNew room owns name, seed, wake mode and the list of picked panes with a per-pane note. Its 'pick panes' button launches PanePicker.\nPanePicker is standalone: it fetches the pane list, filters, peeks, selects, and resolves with the picked rows. The caller decides which rows are disabled and why. With allowCreate it can also start a new pane (cwd, account, model, effort, opening prompt) and list it as 'starting' until Claude is idle."},
    {"id": "states", "x": 2760, "y": 5620, "w": 420, "text": "Picker row states drawn: selected (acme, with peek open), selected but working (fred: invite queues), disabled by the caller (meg: already in the room; june: blocked at a prompt), offline (otis), not signed in (mr-board), starting (a pane the picker just spawned).\nLight is the default here, matching every other artboard; flip dark to check it."}
  ],
  "launch": {"view": "canvas"}
}
pathlib.Path('canvas.json').write_text(json.dumps(canvas, indent=2))
print("built 14 artboards + canvas.json")
