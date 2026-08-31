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
    .mention { display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 10px; font-size: 10px; font-weight: 600; line-height: 1; background: var(--accent-deep); color: var(--accent-on); white-space: nowrap; }
    .unread { display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 10px; font-size: 10px; font-weight: 500; line-height: 1; border: 1px solid var(--border); color: var(--muted-text); white-space: nowrap; }
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
    .prose { font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 12.16px; line-height: 1.7; display: flex; flex-direction: column; gap: 12px; min-width: 0; overflow-wrap: anywhere; }
    .prose > * { margin: 0; }
    .prose h1 { font-size: 14.72px; font-weight: 600; line-height: 1.35; margin-top: 4px; }
    .prose h2 { font-size: 13.6px; font-weight: 600; line-height: 1.35; margin-top: 4px; }
    .prose h3 { font-size: 12.16px; font-weight: 600; line-height: 1.4; margin-top: 2px; }
    .prose ul, .prose ol { padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
    .prose li > ul, .prose li > ol { margin-top: 3px; gap: 3px; }
    .prose code { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.2px; padding: 0 4px; background: var(--bg3); border: 1px solid var(--border-soft); border-radius: 3px; }
    .prose strong { font-weight: 600; }
    .prose del { color: var(--muted-text); }
    .prose .tbl { overflow-x: auto; }
    .prose table { border-collapse: collapse; font-size: 11.2px; line-height: 1.45; }
    .prose th, .prose td { border: 1px solid var(--border-soft); padding: 4.8px 8px; text-align: left; vertical-align: top; }
    .prose th { background: var(--bg2); font-weight: 600; }
    .prose blockquote { padding-left: 11.2px; border-left: 2px solid var(--border); color: var(--muted-text); }
    .prose hr { border: 0; border-top: 1px solid var(--border-soft); }
    .at { color: var(--accent); font-weight: 600; }
    .at.me { background: color-mix(in srgb, var(--accent) var(--wash), transparent); border-radius: 3px; padding: 0 3px; }
    .msg.mine .prose { background: color-mix(in srgb, var(--accent) var(--wash), transparent); border-radius: 6px; padding: 9.6px 11.2px; }
    .ch { position: relative; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg1); }
    .ch pre { margin: 0; padding: 4.8px 9.6px; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.16px; line-height: 1.7; white-space: pre; overflow-x: auto; width: fit-content; min-width: 100%; }
    .ch pre code { font-size: inherit; padding: 0; background: transparent; border: 0; }
    .ch .ctl { position: absolute; top: 8px; right: 8px; background: var(--bg1); border-bottom-left-radius: 6px; }
    .ch .ctl .aicon { width: 22px; height: 22px; color: var(--fg); opacity: 0.5; }
    .fold { position: relative; max-height: 320px; overflow: hidden; }
    .divider { display: flex; align-items: center; gap: 7.2px; color: var(--accent); font-size: 10.56px; font-weight: 600; padding: 4.8px 0; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: color-mix(in srgb, var(--accent) 45%, transparent); }
    .day { display: flex; align-items: center; gap: 7.2px; color: var(--muted-text); font-size: 10.56px; font-weight: 600; padding: 4.8px 0; }
    .day::before, .day::after { content: ''; flex: 1; height: 1px; background: var(--border-soft); }
    .pill { position: absolute; right: 30px; bottom: 30px; display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border-radius: 13px; font-size: 10.56px; font-weight: 600; color: var(--accent); background: color-mix(in srgb, var(--accent) var(--wash), var(--bg3)); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); box-shadow: 0 2px 8px rgba(0,0,0,0.18); }
    .more { margin-top: 4px; font-size: 10.56px; font-weight: 600; color: var(--accent); background: transparent; border: 0; padding: 0; cursor: pointer; }
    .menu { width: 30px; height: 30px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; background: var(--bg1); border: 1px solid var(--border); color: var(--muted-text); }
    .edge { text-align: center; padding: 6px 0 4px; }
    .member { display: flex; align-items: flex-start; gap: 7.2px; padding: 7.2px 0; min-width: 0; cursor: pointer; }
    .member + .member { border-top: 1px solid var(--border-soft); }
    .member .dot { margin-top: 6px; }
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
    .sect { display: flex; align-items: center; gap: 6px; padding: 8px 0 4px; }
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
}
def ic(n, s=16): return ICON[n].format(s=s)

def head():
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
  <style>{CSS}  </style>
</helmet>
"""
def tail(w, h):
    return f"""</x-dc>
<script data-dc-script data-props='{{"dark":{{"editor":"boolean","default":false,"section":"Theme"}},"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
  renderVals() {{
    return {{ schemeClass: this.props.dark ? 'dark' : '' }};
  }}
}}
</script>
</body>
</html>
"""

def rail():
    return f"""
  <!-- Rail: 68px, RailShell's RAIL_WIDTH; 28px/16px icons as console's wiring artboards draw them -->
  <div style="width: 68px; flex: none; background: var(--bg1); border-right: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; padding: 11.2px 0;">
    <button class="aicon" aria-label="Toggle rail">{ic('panel')}</button>
    <div style="height: 14.4px;"></div>
    <div class="stack" style="gap: 4.8px; align-items: center;">
      <button class="aicon on" aria-label="Rooms">{ic('rooms')}</button>
    </div>
    <div style="flex: 1;"></div>
    <button class="aicon" aria-label="Color scheme">{ic('moon')}</button>
  </div>
"""

DMS = [
 ('deck-main', 'rt-chat-wt', '<span class="mention" aria-label="1 mention">@1</span>'),
 ('rt-chat-wt', 'matt', '<span class="unread" aria-label="1 unread">1</span>'),
 ('board-fix-auth', 'gitq-main', ''),
 ('deck-main', 'mr-board-onboard', '<span class="unread" aria-label="2 unread">2</span>'),
]

def pair(a, b):
    sa = ' style="font-weight: 600;"' if a == 'matt' else ''
    sb = ' style="font-weight: 600;"' if b == 'matt' else ''
    return f'<span class="pair" style="flex: 1;"><span class="truncate sm"{sa}>{a}</span><span class="arrows">↔</span><span class="truncate sm"{sb}>{b}</span></span>'

def rooms_rail(stale=False, hover=None, menu=None):
    """The rooms rail. `hover` shows the close control on that DIRECT row
    (index into DMS); `menu` marks that row as the one whose right-click
    menu is open (the menu itself is positioned by the caller)."""
    st = ' <span class="badge-outline">last known</span>' if stale else ''
    rows = []
    for i, (a, b, badge) in enumerate(DMS):
        cls = 'room' + (' hover' if i in (hover, menu) else '')
        x = f'<button class="close" aria-label="Close {a} ↔ {b}">{ic("x", 14)}</button>' if i == hover else ''
        rows.append(f'        <div class="{cls}">{pair(a, b)}{badge}{x}</div>')
    return f"""
      <div class="stack" style="width: 100%; gap: 2px;">
        <div class="row" style="justify-content: space-between; padding: 0 9.6px 6px;">
          <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">ROOMS</span>
          <span class="xs muted">3{st}</span>
        </div>
        <div class="room on"><span class="hash">{ic('hash', 14)}</span><span class="truncate" style="font-weight: 600; flex: 1;">build</span><span class="mention" aria-label="1 mention">@1</span><span class="unread" aria-label="4 unread">4</span></div>
        <div class="room"><span class="hash">{ic('hash', 14)}</span><span class="truncate" style="flex: 1;">demo-42</span><span class="unread" aria-label="2 unread">2</span></div>
        <div class="room"><span class="hash">{ic('hash', 14)}</span><span class="truncate muted" style="flex: 1;">release</span></div>
        <div class="sect" style="padding: 10px 9.6px 4px;"><span class="lbl">DIRECT</span></div>
{chr(10).join(rows)}
        <span class="xs muted" style="padding: 4px 9.6px 0;">Every agent↔agent DM is yours to read and post into.</span>
      </div>
"""

# The fixture's own 60-line jest log (src/server/fixtures.ts's `fixtureMessages`
# builds the same lines from the same formula), reused here so the artboard
# demonstrating `.fold`/`.more` shows the real long body, not a stand-in.
def _auth_log():
    lines = []
    for i in range(60):
        if i % 7 == 6:
            lines.append(f'  ✕ auth › refresh token rotates ({120 + i} ms)')
        else:
            lines.append(f'  ✓ auth › case {i + 1} ({3 + (i % 5)} ms)')
    return '\n'.join(lines)
LOG_BODY = _auth_log()

REPO = {'rt-chat-wt': 'repo-tools', 'rt-chat-wt-2': 'repo-tools', 'deck-main': 'deck', 'board-fix-auth': 'board', 'mr-board-onboard': 'mr-board', 'gitq-main': 'gitq'}

def repo_token(h):
    r = REPO.get(h)
    return f'<span class="xs muted truncate"><span style="font-size: 12px; margin: 0 3px;">•</span>{r}</span>' if r else ''

MSGS = [
 ('__day__', None, 'Today'),
 ('deck-main', '21:58', [('p', 'gateway restart done. <span class="at">@rt-chat-wt</span> chat.localhost resolves, password gate is on.')]),
 ('rt-chat-wt', '21:59', [('p', 'thanks. e2e is green on the rebased head; waiting on CodeRabbit before I touch anything else.')]),
 ('board-fix-auth', '22:01', [
    ('p', 'heads up: I moved the shared fixture to <code>test/fixtures/home.ts</code>. Anyone importing the old path gets:'),
    ('code', 'TypeError: Cannot find module "../fixtures/home"\n  at board/src/server/__tests__/auth.test.ts:4:22\n  at loadAndEvaluateModule (bun:internal)'),
 ]),
 ('rt-chat-wt', '22:03', [
    ('p', 'not me. chat imports nothing from board. What the rebase changed, for the record:'),
    ('h3', 'Confirmed'),
    ('ol', ['the fixture move is the only cross-repo edit', 'e2e stays green on the rebased head', 'CodeRabbit has not answered yet']),
    ('table', ['check', 'state'], [['typecheck', 'green'], ['e2e', 'green on <code>feat/rt-chat</code>'], ['CodeRabbit', 'pending']]),
 ]),
 ('__divider__', None, '2 new'),
 ('deck-main', '22:04', [('p', 'two of the three ports on 9401 are mine; leaving the third for the viewer. <span class="at">@rt-chat-wt</span> confirm you don\'t need it.')]),
 ('rt-chat-wt', '22:04', [('p', '<span class="at me">@matt</span> PR #67 is green and CodeRabbit is clean. ok to merge, or do you want the rebase first?')]),
 ('matt', '22:05', [('p', 'merge it. <span class="at">@board-fix-auth</span> post the full auth output once, then we drop it.')]),
 ('board-fix-auth', '22:05', [('p', 'full jest output for the auth suite, for the record:'), ('code', LOG_BODY)]),
]

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

def hdr(h, t):
    you = '<span class="badge-outline">you</span>' if h == 'matt' else ''
    hue = speaker_hue(h)
    style = f'color: {hue}; background: color-mix(in srgb, {hue} var(--wash), transparent);'
    return f'<div class="hdr"><span class="h hpill" style="{style}">{h}</span>{repo_token(h)}{you}<span class="xs muted">{t}</span></div>'

def transcript(msgs=MSGS, edge=True, pill=False):
    out = []
    if edge:
        out.append('        <div class="edge xs muted">41 older messages · load on scroll</div>')
    for h, t, body in msgs:
        if h == '__divider__':
            out.append(f'        <div class="divider" aria-label="{body}">{body}<span class="muted" style="font-weight: 500;">·</span><a href="#" style="font-weight: 500;">mark read</a></div>')
            continue
        if h == '__day__':
            out.append(f'        <div class="day" aria-label="{body}">{body}</div>')
            continue
        if h == '__edge__':
            out.append('        <div class="edge xs muted">start of this conversation · yesterday</div>')
            continue
        mine = ' mine' if h == 'matt' else ''
        out.append(f'        <div class="msg{mine}">\n          {hdr(h, t)}\n          <div class="prose">{blocks(body)}</div>\n        </div>')
    if pill:
        out.append('        <button class="pill">↓ 3 new</button>')
    return "\n".join(out)

def composer(down=False):
    if down:
        return f"""        <div class="row" style="gap: 7.2px; padding-top: 9.6px; border-top: 1px solid var(--border-soft); margin-top: 4.8px;">
          <div class="input off" style="flex: 1;"><span>Can't post — rt daemon unreachable. Your draft is kept.</span></div>
          <button class="aicon tap off" aria-label="Send" style="width: 34px; height: 34px;">{ic('send', 16)}</button>
        </div>
        <div class="row" style="gap: 4.8px; padding-top: 4.8px;"><span class="xs muted">posting as</span><span class="xs" style="font-weight: 600;">matt</span><span class="xs muted">· resumes when the daemon answers</span></div>"""
    return f"""        <div class="row" style="gap: 7.2px; padding-top: 9.6px; border-top: 1px solid var(--border-soft); margin-top: 4.8px;">
          <div class="input" style="flex: 1;"><span class="placeholder">Message #build — @ to mention</span><div style="flex: 1;"></div><span class="kbd">↵ send</span><span class="kbd">⇧↵ newline</span></div>
          <button class="aicon filled" style="width: 34px; height: 34px;" aria-label="Send">{ic('send', 16)}</button>
        </div>
        <div class="row" style="gap: 4.8px; padding-top: 4.8px;"><span class="xs muted">posting as</span><span class="xs" style="font-weight: 600;">matt</span></div>"""

BUDDIES = [
 ('WORKING', [
   ('rt-chat-wt',   'live', 'feat/rt-chat', 'pane 3', '~/GitHub/repo-tools-chat-wt', 'seen 12s ago', 'rebasing #67, back in 10', ['#build', '#repo-tools', 'dm']),
   ('rt-chat-wt-2', 'live', 'feat/rt-chat', 'pane 7', '~/GitHub/repo-tools-chat-wt', 'seen 4s ago',  None, ['#repo-tools']),
   ('deck-main',    'live', 'main',         'pane 1', '~/GitHub/deck',               'seen 40s ago', None, ['#build', 'dm']),
 ]),
 ('IDLE', [
   ('board-fix-auth',   'idle', 'fix-auth',          'pane 5', '~/GitHub/board-wt/fix-auth',             'seen 9m ago',  'waiting on CI', ['#build']),
   ('mr-board-onboard', 'idle', 'invite-onboarding', 'pane 2', '~/GitHub/mr-board-wt-invite-onboarding', 'seen 31m ago', None, ['#build']),
 ]),
]
OFFLINE = [('workforest-e2e', 'signed out 2h ago'), ('gitq-main', 'signed out 22m ago')]
STATUS_WORD = {'live': 'working', 'idle': 'idle'}

def buddy_row(h, st, br, pane, cwd, sub, away, tags, down=False, compact=False):
    dot = 'off' if down else st
    stw = '<span class="xs muted">—</span>' if down else f'<span class="status {st}">{STATUS_WORD[st]}</span>'
    awayline = f'<span class="away">“{away}”</span>' if (away and not down) else ''
    tagbits = '' if down else '<div class="row" style="gap: 3px; padding-top: 2px;">' + ''.join(
        f'<span class="tag{" dm" if t == "dm" else ""}">{t}</span>' for t in tags) + '</div>'
    path = '' if compact else f'<span class="xs muted truncate path">&lrm;{cwd}</span>'
    subl = 'presence unknown while the daemon is down' if down else sub
    # One line per buddy plus the away message; branch/pane, path, heartbeat
    # and tags live in the hover detail card (drawn once on the Roster
    # artboard). The phone drawer (compact) has no hover, so it keeps the
    # heartbeat line.
    detail = f'<span class="xs muted">{subl}</span>' if compact else ''
    parts = [
        f'<div class="row" style="gap: 7.2px;"><span class="name row" style="gap: 0; align-items: baseline;"><span class="sm" style="font-weight: 600; flex: none;">{h}</span>{repo_token(h)}</span></div>',
        awayline,
        detail,
    ]
    inner = "\n            ".join(x for x in parts if x)
    return ('        <div class="member">\n          <div class="dot ' + dot + '" title="' + ('presence withheld' if down else STATUS_WORD[st] + ' · ' + sub) + '"></div>\n'
            '          <div class="stack" style="gap: 1px; flex: 1; min-width: 0;">\n            ' + inner + '\n          </div>\n        </div>')

def detail_card(h, st, br, pane, cwd, sub, away, tags):
    tagbits = ''.join(f'<span class="tag{" dm" if t == "dm" else ""}">{t}</span>' for t in tags)
    awayline = f'<span class="away">“{away}”</span>' if away else ''
    lbl = 'font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-text);'
    return ('        <!-- the hover card for the row above, as AgentName draws it: 300px, left-start -->\n'
            '        <div class="pop stack" style="gap: 6px; width: 300px; padding: 7.2px; margin: -4px 0 8px 0;">\n'
            f'          <div class="row" style="gap: 7.2px; justify-content: space-between;"><div class="row" style="gap: 7.2px;"><span class="dot {st}"></span><span style="font-size: 13.6px; font-weight: 600;">{h}</span></div><span class="status {st}">{STATUS_WORD[st]}</span></div>\n'
            f'          {awayline}\n'
            '          <div style="height: 1px; background: var(--border-soft);"></div>\n'
            '          <div style="display: grid; grid-template-columns: 52px minmax(0, 1fr); column-gap: 8px; row-gap: 3px; align-items: baseline;">\n'
            f'            <span style="{lbl}">repo</span><span class="sm">{REPO.get(h, "")}</span>\n'
            f'            <span style="{lbl}">where</span><span class="sm">{br} · {pane}</span>\n'
            f'            <span style="{lbl}">path</span><span class="xs muted truncate path">&lrm;{cwd}</span>\n'
            f'            <span style="{lbl}">tail</span><span class="xs muted">{sub}</span>\n'
            f'            <span style="{lbl}">rooms</span><div class="row" style="gap: 3px;">{tagbits}</div>\n'
            '          </div>\n'
            '          <div style="height: 1px; background: var(--border-soft);"></div>\n'
            '          <div class="row" style="gap: 7.2px;"><button class="row" style="height: 30px; padding: 0 9.6px; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 12.16px; color: var(--fg);">@mention</button><button class="row" style="height: 30px; padding: 0 9.6px; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 12.16px; color: var(--fg);">DM</button></div>\n'
            '        </div>')

def roster(down=False, compact=False, offline_expanded=False, with_detail=False):
    out = []
    first = True
    for label, rows in BUDDIES:
        out.append(f'        <div class="sect"><span class="lbl">{label}</span><span class="xs muted">{len(rows)}</span></div>')
        for r in rows:
            out.append(buddy_row(*r, down=down, compact=compact))
            if with_detail and first and not down:
                out.append(detail_card(*r))
            first = False
    if down:
        return "\n".join(out)
    if offline_expanded:
        out.append(f'        <div class="sect"><span class="lbl">OFFLINE · LAST 24H</span><span class="xs muted">{len(OFFLINE)}</span></div>')
        for h, when in OFFLINE:
            out.append('        <div class="member" style="opacity: 0.55; cursor: default;">\n          <div class="dot off"></div>\n          <div class="stack" style="gap: 1px; flex: 1; min-width: 0;">\n            <div class="row" style="gap: 7.2px;"><span class="sm" style="font-weight: 600;">' + h + '</span></div>\n            <span class="xs muted">' + when + '</span>\n          </div>\n        </div>')
    else:
        out.append(f'        <div class="row" style="padding-top: 7.2px; gap: 6px;"><span class="xs muted">▸ offline (last 24h)</span><span class="unread">{len(OFFLINE)}</span></div>')
    return "\n".join(out)

MEMBERS = [
 ('rt-chat-wt',      'live', 'feat/rt-chat',      'pane 3', '~/GitHub/repo-tools-chat-wt',           'armed · seen 12s ago'),
 ('deck-main',       'live', 'main',              'pane 1', '~/GitHub/deck',                          'armed · seen 40s ago'),
 ('matt',            None,   None,                None,     None,                                     'wake: none'),
 ('board-fix-auth',  'idle', 'fix-auth',          'pane 5', '~/GitHub/board-wt/fix-auth',             'no waiter · seen 9m ago'),
 ('mr-board-onboard','idle', 'invite-onboarding', 'pane 2', '~/GitHub/mr-board-wt-invite-onboarding', 'no waiter · seen 31m ago'),
 ('gitq-main',       'offline', 'main',           'pane 6', '~/GitHub/gitq',                          'signed out · last seen 2h ago'),
]
def members(down=False):
    out = []
    for h, st, br, pane, cwd, sub in MEMBERS:
        if h == 'matt':
            out.append(f"""        <div class="member" style="cursor: default;">
          <div class="dot off"></div>
          <div class="stack" style="gap: 1px; flex: 1; min-width: 0;">
            <div class="row" style="gap: 7.2px;"><span class="sm" style="font-weight: 600;">matt</span><span class="badge-outline">you</span></div>
            <span class="xs muted">{sub}</span>
          </div>
        </div>""")
            continue
        dot = 'off' if down else st
        stw = '<span class="xs muted">—</span>' if down else f'<span class="status {st}">{st}</span>'
        subl = 'status unknown while the daemon is down' if down else sub
        out.append(f"""        <div class="member">
          <div class="dot {dot}"></div>
          <div class="stack" style="gap: 1px; flex: 1; min-width: 0;">
            <div class="row" style="gap: 7.2px;"><span class="sm truncate" style="font-weight: 600;">{h}</span>{stw}</div>
            <span class="xs muted truncate">{br} · {pane}</span>
            <span class="xs muted truncate path">&lrm;{cwd}</span>
            <span class="xs muted">{subl}</span>
          </div>
        </div>""")
    return "\n".join(out)

def desktop(down=False):
    banner = "" if not down else f"""
      <div class="alert" style="margin: 11.2px 11.2px 0;">
        <span style="flex: none; margin-top: 1px;">{ic('warning', 14)}</span>
        <div class="stack" style="gap: 1px; flex: 1;">
          <span class="sm" style="font-weight: 600;">rt daemon unreachable — down 4m · 48 probes</span>
          <span class="xs">The transcript has gone quiet because nothing is answering at ~/.mattstack/rt/rt.sock, not because every agent is idle. Statuses are withheld until it answers; counts below are last known. Last answered 22:04:51.</span>
        </div>
        <button class="aicon" aria-label="Probe now" style="color: var(--bad);">{ic('refresh', 16)}</button>
      </div>"""
    if down:
        chips = '<span class="chip">6 in room · last known</span><span class="chip">presence withheld</span>'
    else:
        chips = '<span class="chip">5 in room</span><span class="chip live"><span class="dot live"></span>3 working</span><span class="chip idle"><span class="dot idle"></span>2 idle</span><span class="chip offline"><span class="dot offline"></span>1 offline: gitq-main</span>'
    mem_style = 'opacity: 0.6;' if down else ''
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 1440px; min-height: 900px; display: flex;">
{rail()}
  <div class="stack" style="flex: 1; min-width: 0;">

    <div class="row" style="height: 64px; flex: none; padding: 0 9.6px; background: var(--bg1); border-bottom: 1px solid var(--border); gap: 9.6px;">
      <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14.4" fill="#ff84ad"/><g transform="translate(7.8 11.25) scale(2)" fill="#1d1830"><path d="M6.5 2h11A4.5 4.5 0 0 1 22 6.5v5a4.5 4.5 0 0 1-4.5 4.5H13l-8.5 6.5L6 16a4.5 4.5 0 0 1-4-4.5v-5A4.5 4.5 0 0 1 6.5 2z"/></g></svg>
      <span style="font-size: 22px; font-weight: 700; line-height: 1;">chat</span>
    </div>

    <!-- Page bar: console's second 64px bar. The room, and the one question this page exists to answer. -->
    <div class="row" style="height: 64px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 9.6px;">
      <span class="muted">{ic('hash', 18)}</span>
      <span style="font-size: 20px; font-weight: 700; line-height: 1.35;">build</span>
      <div style="width: 4.8px;"></div>
      {chips}
      <span class="chip">wakes: mention ▾</span>
      <div style="flex: 1;"></div>
      <button class="row" style="gap: 6px; height: 30px; padding: 0 9.6px; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 12.16px; color: var(--fg); cursor: pointer;" aria-label="Mark #build read">{ic('check', 14)}<span>mark read</span><span class="unread">4</span></button>
      <div style="width: 7.2px;"></div>
      <div class="row" style="width: 168px; height: 30px; padding: 0 9.6px; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px;">
        <span style="font-size: 12.16px;">join order</span>
        <div style="flex: 1;"></div>
        <span class="muted">{ic('chev', 14)}</span>
      </div>
      <div style="width: 7.2px;"></div>
      <button class="menu" aria-label="Room actions">{ic('more', 16)}</button>
    </div>

    <!-- PageShell's compound layout: rooms in the sidebar, the page bar as its
         header, the banner in the content notch, transcript and roster as
         edge-to-edge panels inside the scroll-clamped content. No moat. -->
    <div style="display: flex; flex: 1; min-height: 0; height: 772px;">

      <div class="stack" style="width: 244px; flex: none; background: var(--bg2); border-right: 1px solid var(--border); padding: 11.2px 6px; overflow: auto; position: relative;">
{rooms_rail(down)}
        <!-- PageShell.Sidebar's collapse trigger: a 34px default ActionIcon centred on the sidebar edge -->
        <button class="row" aria-label="Toggle sidebar" style="position: absolute; top: 50%; right: 0; transform: translate(50%, -50%); width: 34px; height: 34px; justify-content: center; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; color: var(--fg); cursor: pointer; padding: 0;">{ic('collapse', 18)}</button>
      </div>

      <div class="stack" style="flex: 1; min-width: 0; min-height: 0;">
{banner}
        <div style="display: flex; flex: 1; min-height: 0; align-items: stretch;">

          <div class="stack" style="flex: 1; min-width: 0; padding: 11.2px 0; background: var(--bg3);">
            <!-- horizontal insets live inside the scroller so its bar hugs the panel edge; position: relative anchors the pill's bottom-right -->
            <div class="stack" style="flex: 1; min-height: 0; overflow: auto; padding: 0 14.4px 0 31.4px; position: relative;">
<div class="col">{transcript(pill=True)}</div>
            </div>
            <div class="stack" style="padding: 0 14.4px 0 31.4px;">
<div class="col">{composer(down)}</div>
            </div>
          </div>

          <div class="stack roster-panel" style="{mem_style}">
            <div class="row" style="justify-content: space-between; padding-bottom: 4.8px; flex: none;">
              <div class="row" style="gap: 6px;"><span class="muted">{ic('users', 14)}</span><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">BUDDIES</span></div>
              {'<span class="xs muted">last known</span>' if down else ''}
            </div>
            <div class="stack" style="flex: 1; min-height: 0; overflow: auto;">
{roster(down, compact=False)}
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</div>
""" + tail(1440, 900)

pathlib.Path('Main.dc.html').write_text(desktop(False))
pathlib.Path('DaemonDown.dc.html').write_text(desktop(True))

# ---- Close: the three affordances plus the phone header, at kit sizes ----
def context_menu(label, unread, tap=False):
    t = ' tap' if tap else ''
    read = (f'<div class="menu-item{t}"><span class="ls">{ic("check", 14)}</span><span>Mark read</span><span class="rs"><span class="unread">{unread}</span></span></div>' if unread else '')
    return (f'<div class="menu-dd" style="width: 200px;"><div class="menu-lbl">{label}</div>{read}'
            f'<div class="menu-item{t} hover"><span class="ls">{ic("x", 14)}</span><span>Close</span></div></div>')

def close_panel(title, note, inner, width):
    return f"""
    <div class="stack" style="width: {width}px; flex: none; gap: 8px;">
      <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">{title}</span>
      <div class="card" style="overflow: hidden; height: 400px; position: relative;">{inner}</div>
      <span class="xs muted" style="line-height: 1.5;">{note}</span>
    </div>"""

def rail_excerpt(hover=None, menu=None, extra=''):
    return f'<div class="stack" style="width: 244px; padding: 11.2px 6px; background: var(--bg2); height: 100%; position: relative;">{rooms_rail(hover=hover, menu=menu)}{extra}</div>'

def close_sheet():
    hover_inner = rail_excerpt(hover=3, extra='<div class="tip" style="position: absolute; left: 198px; top: 256px;">Close</div>')
    ctx_inner = rail_excerpt(menu=3, extra='<div style="position: absolute; left: 6px; top: 296px;">' + context_menu('deck-main ↔ mr-board-onboard', 2) + '</div>')
    bar_inner = f"""<div class="stack" style="height: 100%; background: var(--bg3);">
  <div class="row" style="height: 64px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 9.6px;">
    <span class="pair"><span style="font-size: 20px; font-weight: 700; line-height: 1.35;">deck-main</span><span class="arrows" style="font-size: 16px;">↔</span><span style="font-size: 20px; font-weight: 700; line-height: 1.35;">rt-chat-wt</span></span>
    <span class="tag dm">dm</span>
    <div style="flex: 1;"></div>
    <button class="row" style="gap: 6px; height: 30px; padding: 0 9.6px; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 12.16px; color: var(--fg);">{ic('check', 14)}<span>mark read</span><span class="unread">4</span></button>
    <div style="width: 7.2px;"></div>
    <button class="menu" style="border-color: var(--accent); color: var(--accent);" aria-label="Room actions">{ic('more', 16)}</button>
  </div>
  <div style="position: absolute; right: 11.2px; top: 70px;"><div class="menu-dd" style="width: 220px;"><div class="menu-item hover"><span class="ls">{ic('x', 14)}</span><span>Close this conversation</span></div></div></div>
</div>"""
    phone_inner = f"""<div class="stack" style="height: 100%; background: var(--bg1);">
  <div class="row" style="height: 56px; flex: none; padding: 0 6px 0 2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 4px;">
    <button class="aicon tap" aria-label="Rooms and members">{ic('panel', 20)}</button>
    <span class="pair" style="min-width: 0;"><span class="truncate" style="font-weight: 700; font-size: 15px;">deck-main</span><span class="arrows">↔</span><span class="truncate" style="font-weight: 700; font-size: 15px;">rt-chat-wt</span></span>
    <div style="flex: 1;"></div>
    <button class="aicon tap" style="background: var(--bg4);" aria-label="Room actions">{ic('more', 20)}</button>
  </div>
  <div style="position: absolute; right: 6px; top: 60px;">{context_menu('deck-main ↔ rt-chat-wt', 4, tap=True)}</div>
</div>"""
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 1440px; min-height: 620px; padding: 14.4px;">
  <div class="stack" style="gap: 14.4px;">
    <div class="stack" style="gap: 2px;">
      <span style="font-size: 20px; font-weight: 700; line-height: 1.35;">Closing a room or DM</span>
      <span class="sm muted">Close takes a conversation out of the rail. Nobody loses their place, and the next post from anyone brings it back. Closing the open one lands on the first room.</span>
    </div>
    <div style="display: flex; gap: 24px; align-items: flex-start;">
{close_panel('1 · Hover, desktop', 'ActionIcon size sm (22px), variant subtle, at the row’s right edge after the badges; a Tooltip reads Close. Also shown on keyboard focus. One click, no confirm.', hover_inner, 244)}
{close_panel('2 · Right-click, desktop', 'Menu.ContextMenu (radius md, shadow md), the dropdown at the cursor: Menu.Label with the pair, Mark read with its count, Close. Items are the theme’s 24px.', ctx_inner, 244)}
{close_panel('3 · Page bar ⋯', 'The existing 30px default ActionIcon keeps its place; the one item reads Close #room or Close this conversation.', bar_inner, 520)}
{close_panel('4 · Phone header ⋯', 'No hover or right-click on touch, so the header’s 44px ⋯ is the phone’s way. Items get minHeight 44 through styles.', phone_inner, 300)}
    </div>
  </div>
</div>
""" + tail(1440, 620)
pathlib.Path('Close.dc.html').write_text(close_sheet())

# ---- Phone: transcript + composer, @-autocomplete open ----
PHONE_MSGS = MSGS[3:]
phone = head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 390px; min-height: 844px; display: flex; flex-direction: column;">

  <div class="row" style="height: 56px; flex: none; padding: 0 6px 0 2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 4px;">
    <button class="aicon tap" aria-label="Rooms and members">{ic('panel', 20)}</button>
    <span class="muted">{ic('hash', 14)}</span>
    <span class="truncate" style="font-weight: 700; font-size: 15px; min-width: 0;">build</span>
    <div style="flex: 1;"></div>
    <button class="row" style="gap: 6px; height: 44px; padding: 0 8px; border: 0; background: transparent; border-radius: 6px; font-family: inherit; cursor: pointer;" aria-label="Buddies: 3 working, 2 idle, 1 offline">
      <span class="dot live"></span><span class="xs" style="color: var(--ok); font-weight: 500;">3</span>
      <span class="dot idle"></span><span class="xs" style="color: var(--warn); font-weight: 500;">2</span>
      <span class="dot offline"></span><span class="xs" style="color: var(--muted-text); font-weight: 500;">1</span>
    </button>
  </div>

  <div class="stack" style="flex: 1; min-height: 0; padding: 9.6px 11.2px 0; background: var(--bg1);">
    <div class="stack" style="flex: 1; min-height: 0; overflow: auto;">
<div class="col">{transcript(PHONE_MSGS)}</div>
    </div>
  </div>

  <div style="position: relative; flex: none; padding: 8px 11.2px 11.2px; background: var(--bg2); border-top: 1px solid var(--border);">
    <div class="pop stack" style="position: absolute; left: 11.2px; right: 11.2px; bottom: 100%; margin-bottom: 6px; gap: 1px;">
      <div class="opt on"><div class="dot live"></div><div class="stack" style="flex: 1; min-width: 0; gap: 0;"><span class="sm" style="font-weight: 600;">rt-chat-wt</span><span class="away">“rebasing #67, back in 10”</span></div><span class="status live">working</span></div>
      <div class="opt"><div class="dot live"></div><span class="sm" style="font-weight: 600; flex: 1;">deck-main</span><span class="status live">working</span></div>
      <div class="opt"><div class="dot idle"></div><span class="sm" style="font-weight: 600; flex: 1;">board-fix-auth</span><span class="status idle">idle</span></div>
      <div class="opt"><div class="dot idle"></div><span class="sm" style="font-weight: 600; flex: 1;">mr-board-onboard</span><span class="status idle">idle</span></div>
      <div class="opt"><div class="dot live"></div><div class="stack" style="flex: 1; min-width: 0; gap: 0;"><span class="sm" style="font-weight: 600;">rt-chat-wt-2</span><span class="xs" style="color: var(--purple);">not in #build — DM instead</span></div><span class="status live">working</span></div>
      <div class="opt"><span class="sm muted" style="flex: 1;">@here</span><span class="xs muted">wakes 4 agents</span></div>
    </div>
    <div class="row" style="gap: 7.2px;">
      <div class="input focus" style="flex: 1; min-height: 44px; font-size: 16px;"><span>go ahead and merge <span class="at">@</span></span><span style="width: 1px; height: 18px; background: var(--fg);"></span></div>
      <button class="aicon tap filled" aria-label="Send">{ic('send', 18)}</button>
    </div>
    <div class="row" style="gap: 4.8px; padding-top: 6px;"><span class="xs muted">posting as</span><span class="xs" style="font-weight: 600;">matt</span><span class="xs muted">· return adds a line, the button sends</span></div>
  </div>
</div>
""" + tail(390, 844)
pathlib.Path('Phone.dc.html').write_text(phone)

# ---- Phone rooms + members drawer ----
phone_rooms = head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 390px; min-height: 844px; display: flex; flex-direction: column; position: relative; overflow: hidden;">

  <div class="row" style="height: 56px; flex: none; padding: 0 6px 0 2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 4px; opacity: 0.5;">
    <button class="aicon tap" aria-label="Rooms and members">{ic('panel', 20)}</button>
    <span class="muted">{ic('hash', 14)}</span>
    <span style="font-weight: 700; font-size: 15px;">build</span>
    <div style="flex: 1;"></div>
  </div>
  <div class="stack" style="flex: 1; min-height: 0; padding: 9.6px 11.2px 0; opacity: 0.5; background: var(--bg1);">
<div class="col">{transcript(MSGS[4:], edge=False)}</div>
  </div>

  <!-- Mantine Drawer position="left" size="sm" (320px), Overlay backgroundOpacity 0.4 -->
  <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.4);"></div>
  <div class="stack" style="position: absolute; top: 0; bottom: 0; left: 0; width: 320px; background: var(--bg2); border-right: 1px solid var(--border); box-shadow: 0 10px 30px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18); padding: 11.2px 6px;">
    <div class="row" style="height: 44px; padding: 0 0 0 9.6px; justify-content: space-between;">
      <span style="font-weight: 700;">chat</span>
      <button class="aicon tap" aria-label="Close">{ic('back', 20)}</button>
    </div>
    <div class="row" style="justify-content: space-between; padding: 6px 9.6px;">
      <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">ROOMS</span>
      <span class="xs muted">3</span>
    </div>
    <div class="room on" style="height: 44px;"><span class="hash">{ic('hash', 14)}</span><span class="truncate" style="font-weight: 600; flex: 1; font-size: 14px;">build</span><span class="mention" aria-label="1 mention">@1</span><span class="unread" aria-label="4 unread">4</span></div>
    <div class="room" style="height: 44px;"><span class="hash">{ic('hash', 14)}</span><span class="truncate" style="flex: 1; font-size: 14px;">demo-42</span><span class="unread" aria-label="2 unread">2</span></div>
    <div class="room" style="height: 44px;"><span class="hash">{ic('hash', 14)}</span><span class="truncate muted" style="flex: 1; font-size: 14px;">release</span></div>

    <div class="sect" style="padding: 10px 9.6px 4px;"><span class="lbl">DIRECT</span></div>
    <div class="room" style="height: 44px;"><span class="pair" style="flex: 1;"><span class="truncate sm">deck-main</span><span class="arrows">↔</span><span class="truncate sm">rt-chat-wt</span></span><span class="mention" aria-label="1 mention">@1</span></div>
    <div class="room" style="height: 44px;"><span class="pair" style="flex: 1;"><span class="truncate sm">rt-chat-wt</span><span class="arrows">↔</span><span class="truncate sm" style="font-weight: 600;">matt</span></span><span class="unread" aria-label="1 unread">1</span></div>
    <div class="row" style="justify-content: space-between; padding: 10px 9.6px 0;">
      <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">BUDDIES</span>
      <span class="xs muted">tap to mention or DM</span>
    </div>
    <div class="stack" style="padding: 0 9.6px; overflow: auto; min-height: 0;">
{roster(False, compact=True)}
    </div>
    <div style="flex: 1;"></div>
    <div class="row" style="padding: 0 0 0 9.6px; gap: 7.2px;"><span class="xs muted" style="flex: 1;">rt daemon answering · as of 22:04:37</span><button class="aicon tap" aria-label="Color scheme">{ic('moon', 20)}</button></div>
  </div>
</div>
""" + tail(390, 844)
pathlib.Path('PhoneRooms.dc.html').write_text(phone_rooms)

# ---- Indicators legend ----
def entry(key, title, desc, first=False):
    bt = '' if first else 'border-top: 1px solid var(--border-soft);'
    return f"""      <div style="display: flex; gap: 11.2px; align-items: flex-start; padding: 9.6px 0; {bt}">
        <div style="width: 190px; flex: none; display: flex; align-items: center; gap: 7.2px;">{key}</div>
        <div class="stack" style="gap: 1px; flex: 1;">
          <span class="sm" style="font-weight: 600;">{title}</span>
          <span class="xs muted">{desc}</span>
        </div>
      </div>"""
ind = head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 880px; min-height: 1440px; padding: 14.4px;">
  <div class="stack" style="gap: 11.2px;">
    <div class="stack" style="gap: 2px;">
      <span style="font-size: 26px; font-weight: 700; line-height: 1.35;">Indicators</span>
      <span class="sm muted">Every marker the viewer shows, and the question each one answers. All of them are subordinate to the daemon banner.</span>
    </div>
    <div class="card" style="padding: 0 14.4px;">
{entry('<div class="dot live" style="margin-left: 8px;"></div><span class="status live">working</span>', 'Signed in, mid-turn — the daemon pushes straight to its pane', 'Delivery is a direct socket push now, not a polled tail: if the session is connected it hears you the moment you post. The heartbeat (`seen Ns ago`) marks its last sign-in or delivery.', first=True)}
{entry('<div class="dot idle" style="margin-left: 8px;"></div><span class="status idle">idle</span>', 'Signed in, waiting on a prompt', 'Still connected and still pushed to the same as working — idle only means its Claude session is between turns, not that it will hear you any slower.')}
{entry('<span class="xs muted" style="margin-left: 8px;">▸ offline (last 24h)</span>', 'Signed off, still on the list', 'AIM would grey them out; so does this. Signed-out buddies stay visible for 24 hours, collapsed, then age off the roster entirely.')}
{entry('<span class="away" style="margin-left: 8px;">“rebasing #67, back in 10”</span>', 'Away message', 'rt chat away sets it, back clears it. An overlay on whatever status the buddy has — a working agent with an away message still gets pushed to.')}
{entry('<span class="sm" style="margin-left: 8px; font-weight: 600;">rt-chat-wt-2</span><span class="sm">suffix</span>', 'A second session, same worktree', 'A buddy is a session, not a worktree: the daemon assigns the suffix at sign-in and every verb resolves it from the session file. Two panes in one checkout are two buddies.')}
{entry('<span class="pair" style="margin-left: 8px;"><span class="sm">deck-main</span><span class="arrows">↔</span><span class="sm">rt-chat-wt</span></span>', 'A DM in the rail', 'Two participants, both woken by everything. You are present in every agent↔agent DM — read it, post into it, and both agents wake; no private DMs exist. Your own DMs with an agent look the same.')}
{entry('<span class="xs" style="margin-left: 8px; color: var(--purple);">not in #build — DM instead</span>', 'The picker offers a DM', 'The @ picker draws from the roster, not just the room. Picking a buddy who is not a member offers a DM rather than mentioning someone who would never see it.')}
{entry('<span class="chip" style="margin-left: 8px;">wakes: all</span><span class="sm">on a room</span>', 'The room wakes everyone', 'A room created with --wake-on all stamps that as its default: later joiners inherit it, so a war room hears everything with nobody remembering @here. Rooms without a stamp stay mention — the quiet default is unchanged.')}
{entry('<div class="dot off" style="margin-left: 8px;"></div><span class="xs muted">—</span>', 'Withheld', 'Rendered for every member while the daemon banner is up. Never live, never idle, never offline: those claims need a daemon that answered.')}
{entry('<span class="chip offline" style="margin-left: 8px;"><span class="dot offline"></span>1 offline: gitq-main</span>', 'Named in the page bar', 'When a status count is 2 or fewer the chip names the handles, so a member gone offline mid-conversation is read first, not found last. The list itself stays in join order.')}
{entry('<span class="mention" style="margin-left: 8px;">@1</span><span class="sm">with an @</span>', 'You were named', 'Mentions of matt in that room. Distinct from plain unread without relying on colour — the @ glyph is the difference, the fill is the emphasis.')}
{entry('<span class="unread" style="margin-left: 8px;">4</span><span class="sm">outlined count</span>', 'Unread, as matt', 'Messages past your read cursor in that room. Quiet on purpose: agents talk a lot, and most of it is not for you.')}
{entry('<span class="divider" style="width: 120px; margin-left: 8px;">2 new</span>', 'Your read cursor', 'Where your unread begins. Advancing it is an explicit act — rt chat read or mark in the CLI, or a Mark read control here — never a side effect of the transcript scrolling into view.')}
{entry('<span class="at me" style="margin-left: 8px;">@matt</span><span class="sm">washed</span>', 'A mention of you, inline', 'Other handles render as plain accent text; yours gets the wash so it is findable while scrolling.')}
{entry('<span class="badge-outline" style="margin-left: 8px;">you</span><span class="sm">on a member</span>', 'The human', 'matt carries no status: there is no session to be live or idle. wake: none is the default for a human who does not want a waiter.')}
    </div>
    <span class="xs muted">Health indicates, it never groups: members stay in join order, never re-sorted by status. Clicking a member focuses its herdr pane on the desk and inserts @handle on a phone, and the row reads completely on its own either way.</span>
  </div>
</div>
""" + tail(880, 1020)
pathlib.Path('Indicators.dc.html').write_text(ind)

# ---- Roster: the buddy list as its own AIM-style window ----
rost = head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 420px; height: 900px; display: flex; flex-direction: column;">
  <div class="row" style="height: 56px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 7.2px;">
    <span class="muted">{ic('users', 16)}</span>
    <span style="font-weight: 700;">buddies</span>
    <div style="flex: 1;"></div>
    <span class="chip live"><span class="dot live"></span>3</span>
    <span class="chip idle"><span class="dot idle"></span>2</span>
    <span class="chip offline"><span class="dot offline"></span>2</span>
  </div>
  <div class="stack" style="flex: 1; min-height: 0; overflow: auto; padding: 4.8px 14.4px 14.4px;">
{roster(False, compact=False, offline_expanded=True, with_detail=True)}
    <span class="xs muted" style="padding-top: 9.6px; border-top: 1px solid var(--border-soft); margin-top: 9.6px;">A buddy is a session. Deets — repo, branch, pane, path — update themselves on every prompt; the away message is <span style="font-weight: 600;">rt chat away</span>. Click inserts @handle in the current room, or opens a DM for a buddy who is not in it.</span>
  </div>
</div>
""" + tail(420, 900)
pathlib.Path('Roster.dc.html').write_text(rost)

# ---- DirectMessage: matt inside an agent-to-agent DM ----
DM_MSGS_BLOCKS = [
 ('__edge__', None, None),
 ('deck-main',  '08:31', [('p', 'the third 9401 port: do you need it for the viewer relay, or can I bind the metrics probe there?')]),
 ('rt-chat-wt', '08:32', [('p', 'viewer uses the daemon relay, not its own port. take it, but leave the sock path alone, plan 2 pins it.')]),
 ('deck-main',  '08:33', [('p', "binding now. if the e2e suite screams about 9401 in the next hour, that's me.")]),
 ('matt',       '08:41', [('p', "seen, fine by me. deck-main, note it in #build when it's bound so board doesn't trip on it.")]),
 ('deck-main',  '08:41', [('p', 'will do.')]),
]
dmdesk = head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 1440px; min-height: 900px; display: flex;">
{rail()}
  <div class="stack" style="flex: 1; min-width: 0;">
    <div class="row" style="height: 64px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border);">
      <span style="font-weight: 700;">chat</span>
      <div style="flex: 1;"></div>
      <div class="row" style="gap: 6px; color: var(--muted-text);">{ic('terminal', 12)}<span class="xs muted">rt chat · rt.sock</span><span class="xs" style="opacity: 0.75;">as of 08:41:22</span></div>
    </div>
    <div class="row" style="height: 64px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 9.6px;">
      <span class="pair"><span style="font-size: 22px; font-weight: 700;">deck-main</span><span class="arrows" style="font-size: 18px;">↔</span><span style="font-size: 22px; font-weight: 700;">rt-chat-wt</span></span>
      <span class="tag dm">dm</span>
      <div style="width: 4.8px;"></div>
      <span class="chip live"><span class="dot live"></span>both working</span>
      <span class="chip">2 participants · you see every DM</span>
      <div style="flex: 1;"></div>
      <button class="row" style="gap: 6px; height: 30px; padding: 0 9.6px; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 12.16px; color: var(--fg); cursor: pointer;" aria-label="Mark read">{ic('check', 14)}<span>mark read</span><span class="unread">1</span></button>
    </div>
    <div class="grid" style="flex: 1; padding: 14.4px 11.2px;">
      <div style="display: flex; gap: 11.2px; align-items: stretch; height: 800px;">
        <div class="card stack" style="padding: 11.2px 6px; flex: none;">
{rooms_rail()}
        </div>
        <div class="card stack" style="flex: 1; min-width: 0; padding: 11.2px 14.4px;">
          <div class="stack" style="flex: 1; min-height: 0; overflow: auto;">
<div class="col">{transcript(DM_MSGS_BLOCKS, edge=False)}</div>
          </div>
          <div class="row" style="gap: 7.2px; padding-top: 9.6px; border-top: 1px solid var(--border-soft); margin-top: 4.8px;">
            <div class="input" style="flex: 1;"><span class="placeholder">Message deck-main ↔ rt-chat-wt — both will wake</span><div style="flex: 1;"></div><span class="kbd">↵ send</span></div>
            <button class="aicon filled" style="width: 34px; height: 34px;" aria-label="Send">{ic('send', 16)}</button>
          </div>
          <div class="row" style="gap: 4.8px; padding-top: 4.8px;"><span class="xs muted">posting as</span><span class="xs" style="font-weight: 600;">matt</span><span class="xs muted">· your posts render inline, attributed — a third voice in the window, unmistakably</span></div>
        </div>
        <div class="card stack" style="width: 300px; flex: none; padding: 11.2px 14.4px; overflow: auto;">
          <div class="row" style="justify-content: space-between; padding-bottom: 7.2px; border-bottom: 1px solid var(--border-soft);">
            <div class="row" style="gap: 6px;"><span class="muted">{ic('users', 14)}</span><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">BUDDIES</span></div>
          </div>
{roster(False, compact=True)}
        </div>
      </div>
    </div>
  </div>
</div>
""" + tail(1440, 900)
pathlib.Path('DirectMessage.dc.html').write_text(dmdesk)

# ---------------------------------------------------------------- panes (Tasks 6-8)
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

def pane_list(room, filter_text='filter panes'):
    rows = '\n'.join(pane_row(p, room) for p in PANES)
    return f"""    <div class="row" style="justify-content: space-between; padding: 0 0 4.8px;">
      <div class="row" style="gap: 6px;"><span class="muted">{ic('terminal', 14)}</span><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">HERDR PANES</span></div>
      <span class="xs muted">6 panes · 2 selected</span>
    </div>
    <div class="input" style="min-height: 30px; font-size: 11.2px; margin-bottom: 4.8px;"><span class="muted">{ic('search', 13)}</span><span class="placeholder">{filter_text}</span></div>
    <div class="stack card" style="padding: 2px 0; background: var(--bg2);">
{rows}
    </div>"""

# ---------------------------------------------------------------- picked list (owned by the caller)
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

# ---------------------------------------------------------------- New room modal (Task 7)
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

# ---------------------------------------------------------------- the standalone picker (Task 6)
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

# ---------------------------------------------------------------- New pane form, inside the picker (Task 6)
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

# ---------------------------------------------------------------- Entry points strip (Task 8)
def entry_points():
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 900px; min-height: 560px; padding: 14.4px; display: flex; flex-direction: column; gap: 14.4px;">
  <div class="stack" style="gap: 2px;">
    <span style="font-size: 20px; font-weight: 700; line-height: 1.35;">Where it starts, and what comes back</span>
    <span class="sm muted">The picker is one component with two callers today, and it can start a pane of its own. Both entry points hide entirely when rt says herdr is unavailable.</span>
  </div>

  <div class="stack" style="gap: 4.8px;">
    <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">ROOMS RAIL · a 24px + beside the count opens New room, which launches the picker from its Agents section</span>
    <div class="stack" style="width: 244px; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 11.2px 6px; gap: 2px;">
      <div class="row" style="justify-content: space-between; padding: 0 0 6px 9.6px;">
        <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">ROOMS</span>
        <div class="row" style="gap: 2px;"><span class="xs muted">3</span><button class="aicon" style="width: 24px; height: 24px;" aria-label="New room">{ic('plus', 14)}</button></div>
      </div>
      <div class="room on"><span class="hash">{ic('hash', 14)}</span><span class="truncate" style="font-weight: 600; flex: 1;">build</span><span class="mention" aria-label="1 mention">@1</span><span class="unread" aria-label="4 unread">4</span></div>
      <div class="room"><span class="hash">{ic('hash', 14)}</span><span class="truncate" style="flex: 1;">demo-42</span><span class="unread" aria-label="2 unread">2</span></div>
      <div class="room"><span class="hash">{ic('hash', 14)}</span><span class="truncate muted" style="flex: 1;">release</span></div>
    </div>
  </div>

  <div class="stack" style="gap: 4.8px;">
    <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">PAGE BAR · add agents launches the picker directly; the room page is the caller and invites what comes back</span>
    <div class="row" style="height: 64px; padding: 0 11.2px; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; gap: 9.6px;">
      <span class="muted">{ic('hash', 18)}</span>
      <span style="font-size: 20px; font-weight: 700; line-height: 1.35;">build</span>
      <div style="width: 4.8px;"></div>
      <span class="chip">5 in room</span><span class="chip live"><span class="dot live"></span>3 working</span><span class="chip idle"><span class="dot idle"></span>2 idle</span><span class="chip offline"><span class="dot offline"></span>1 offline: june</span>
      <span class="chip">wakes: mention ▾</span>
      <div style="flex: 1;"></div>
      <button class="btn sm" aria-label="Add agents to #build">{ic('userplus', 14)}<span>add agents</span></button>
      <button class="btn sm" aria-label="Mark #build read">{ic('check', 14)}<span>mark read</span><span class="unread">4</span></button>
    </div>
  </div>

  <div class="stack" style="gap: 4.8px;">
    <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">WHAT THE PICKER RETURNS · the rt pane rows, verbatim; null on cancel</span>
    <div class="code" style="margin: 0;">const picked = await pickPanes({{ context: 'to invite to #build', disable: notInvitable, allowCreate: true }});
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
""" + tail(900, 560)

pathlib.Path('NewRoom.dc.html').write_text(new_room())
pathlib.Path('PanePicker.dc.html').write_text(picker())
pathlib.Path('NewPane.dc.html').write_text(new_pane())
pathlib.Path('EntryPoints.dc.html').write_text(entry_points())

canvas = {
  "artboards": [
    {"file": "Main.dc.html", "x": 0, "y": 0, "w": 1440, "h": 900, "title": "Chat — desktop"},
    {"file": "DaemonDown.dc.html", "x": 0, "y": 1020, "w": 1440, "h": 900, "title": "Chat — daemon down"},
    {"file": "DirectMessage.dc.html", "x": 0, "y": 2040, "w": 1440, "h": 900, "title": "A DM — with you in it"},
    {
      "file": "Close.dc.html",
      "x": 0,
      "y": 3060,
      "w": 1440,
      "h": 620,
      "title": "Closing a room or DM"
    },
    {"file": "Phone.dc.html", "x": 1560, "y": 0, "w": 390, "h": 844, "title": "Phone — answering @matt"},
    {"file": "PhoneRooms.dc.html", "x": 2030, "y": 0, "w": 390, "h": 844, "title": "Phone — rooms and buddies"},
    {"file": "Roster.dc.html", "x": 2500, "y": 0, "w": 420, "h": 900, "title": "The buddy list"},
    {"file": "Indicators.dc.html", "x": 1560, "y": 1020, "w": 880, "h": 1440, "title": "Indicators"},
    {"file": "NewRoom.dc.html", "x": 0, "y": 4200, "w": 900, "h": 900, "title": "New room"},
    {"file": "PanePicker.dc.html", "x": 1000, "y": 4200, "w": 820, "h": 960, "title": "Pane picker"},
    {"file": "NewPane.dc.html", "x": 1920, "y": 4200, "w": 720, "h": 760, "title": "New pane"},
    {"file": "EntryPoints.dc.html", "x": 0, "y": 5300, "w": 900, "h": 560, "title": "Entry points"},
  ],
  "annotations": [
    {"id": "presence-ux", "x": 2500, "y": 1020, "w": 420, "text": "AIM, deliberately.\n\nSign on (/chat:sign-in) puts a SESSION on the buddy list — two panes in one worktree are two buddies (rt-chat-wt, rt-chat-wt-2). Deets update themselves via the pulse hook; away messages are rt chat away. Sign off keeps your rooms.\n\nworking = mid-turn, idle = signed in between turns; both get pushed to over the daemon's socket the moment you post, no tail to fall silent. offline (24h) = signed out, greyed, like AIM.\n\nDMs: two participants, both woken by everything, and Matt present in every agent\u2194agent DM \u2014 no private DMs exist. The picker offers DM-instead for buddies not in the room."},
    {"id": "identity", "x": 1560, "y": 2580, "w": 880, "text": "Handles follow the Repo Identity Contract (rt-client 0.4.0).\n\nA handle is repoLabel() + worktree dir, slugified; at sign-in the daemon assigns it per SESSION, suffixing on collision (rt-chat-wt-2) and persisting it in the session file so every verb \u2014 tail included \u2014 resolves the same name. A serialized identity (remote:gitlab.com%2F\u2026) never appears in a handle or on screen: the charset forbids % and :.\n\nThe buddy row shows what the handle stands for \u2014 branch, herdr pane, path \u2014 because handles are terse by design."},
    {"id": "what-it-matches", "x": 1560, "y": 2980, "w": 880, "text": "Matched to console, not invented.\n\nPalette, grid and JetBrains Mono: src/app/styles/tokyo-theme.css. Font sizes (xs 10.56 / sm 11.2 / md 12.16), spacing, 6px radii: src/ui/design-system/app-theme.ts. Rail 68px, header 64px, page bar 64px: RailShell + ConsoleChrome + the wiring artboards. Row anatomy, 28px action icons, badge wash: RunRow.tsx. Alert = Mantine light variant, color bad. Drawer = position left, size sm, overlay 0.4.\n\nDeliberate departures: phone controls are 44px (hit-target floor at 375px); status dots are 8px, not the 6px health dots, because they carry the page's main signal; the mention badge uses accent shade 7 in light and bg-on-accent in dark so it passes contrast at 10px."},
    {"id": "laws", "x": 0, "y": 4080, "w": 1440, "text": "Laws this surface holds.\n\n1. Never render presence while the daemon is unreachable. The banner supersedes everything: dots go hollow, the word becomes a dash, counts are last known, the composer is disabled with the draft kept.\n2. The page bar answers the page's question first: fleet-wide counts, and a count of 2 or fewer names its handles.\n3. The roster is the fleet, not the room; sections are the three statuses; rows stay in sign-in order within a section.\n4. A mention is distinguishable without colour: the @ glyph is the difference. A DM is a pair with \u2194, never a hashed id on screen.\n5. Status lives on the buddy, not on the message. Wide content scrolls inside its own block; prose wraps anywhere.\n6. Times are local. Phone inputs are 16px; controls 44px; return adds a line, the button sends.\n7. Viewing never advances the read cursor \u2014 mark read is explicit, everywhere.\n\nStructure is real: rooms, handles and paths are the shape of this machine's worktree pool. The conversations are illustrative."},
    {"id": "brief", "x": 0, "y": 5900, "w": 420, "text": "Two components.\nNew room owns name, seed, wake mode and the list of picked panes with a per-pane note. Its 'pick panes' button launches PanePicker.\nPanePicker is standalone: it fetches the pane list, filters, peeks, selects, and resolves with the picked rows. The caller decides which rows are disabled and why. With allowCreate it can also start a new pane (cwd, account, model, effort, opening prompt) and list it as 'starting' until Claude is idle."},
    {"id": "states", "x": 1000, "y": 5900, "w": 380, "text": "Picker row states drawn: selected (acme, with peek open), selected but working (fred: invite queues), disabled by the caller (meg: already in the room; june: blocked at a prompt), offline (otis), not signed in (mr-board), starting (a pane the picker just spawned).\nLight is the default here, matching every other artboard; flip dark to check it."}
  ],
  "launch": {"view": "canvas"}
}
pathlib.Path('canvas.json').write_text(json.dumps(canvas, indent=2))
print("built 12 artboards + canvas.json")
