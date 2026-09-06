"""Direction artboards for the "chat at a glance" round.

Shares the conformance canvas's CSS block (design/build.py) so every value
still matches the app; adds only the pieces these directions introduce.
Rooms, handles, repos, branches and pane ids are today's real fleet
(rt chat who --json, herdr agent list on 2026-09-02); the conversations are
illustrative.
"""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
BASE = (HERE / '../../build.py').resolve()
CSS = re.search(r'CSS = r"""(.*?)"""', BASE.read_text(), re.S).group(1)

EXTRA_CSS = r"""
    .sprite { display: inline-block; width: 10px; height: 10px; flex: none; }
    .hpill.row { display: inline-flex; gap: 5px; align-items: center; }
    .doing { font-size: 10.56px; color: var(--muted-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .doing.path { color: var(--muted); }
    .ws { display: flex; align-items: center; gap: 7.2px; height: 30px; padding: 0 9.6px 0 26px; border-radius: 6px; min-width: 0; overflow: hidden; cursor: pointer; }
    .ws:hover { background: var(--bg4); }
    .ws.on { background: color-mix(in srgb, var(--accent) var(--wash), transparent); }
    .ws .h { font-size: 11.2px; font-weight: 600; flex: none; }
    .ws.more { color: var(--muted-text); font-size: 10.56px; height: 26px; }
    .ws.more span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .grp { color: var(--muted-text); font-size: 11.2px; }
    .dm2 { display: flex; flex-direction: column; gap: 1px; padding: 5px 9.6px; border-radius: 6px; min-width: 0; overflow: hidden; cursor: pointer; }
    .context { opacity: 0.62; }
    .dm2:hover { background: var(--bg4); }
    .card2 { display: flex; flex-direction: column; gap: 6px; padding: 9.6px 11.2px; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; min-width: 0; }
    .card2.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) var(--wash), var(--bg2)); }
    .lead { font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5; color: var(--fg); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    .ctx { display: inline-flex; align-items: center; height: 16px; padding: 0 6px; border-radius: 4px; font-size: 9.5px; font-weight: 600; border: 1px solid var(--border-soft); color: var(--muted-text); white-space: nowrap; }
    .ctx.dm { color: var(--purple); border-color: color-mix(in srgb, var(--purple) 45%, transparent); }
    .strip { display: flex; align-items: center; gap: 16px; height: 44px; padding: 0 14.4px; background: var(--bg2); border-bottom: 1px solid var(--border); flex: none; overflow: hidden; }
    .strip .g { display: inline-flex; align-items: center; gap: 6px; }
    .strip .g .lbl { font-size: 10.56px; font-weight: 600; color: var(--muted-text); }
    .wchip { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg1); font-size: 11.2px; font-weight: 600; cursor: pointer; }
    .wchip.off { color: var(--muted-text); font-weight: 500; }
    .foldrow { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 10.56px; font-weight: 600; color: var(--accent); cursor: pointer; }
    .foldrow .tri { display: inline-block; width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 5px solid currentColor; }
    .sheet-h { font-size: 12.16px; font-weight: 700; }
    .sheet-p { font-size: 11.2px; color: var(--muted-text); line-height: 1.5; }
    .pop { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12); }
    .kv { display: grid; grid-template-columns: 52px minmax(0, 1fr); column-gap: 8px; row-gap: 3px; align-items: baseline; }
    .kv .k { font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-text); }
    .about { display: flex; flex-direction: column; gap: 8px; padding: 9.6px 11.2px; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; }
"""

ICON = {
    'panel': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/></svg>',
    'rooms': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    'inbox': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    'users': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    'moon': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
    'send': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    'hash': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="m16 3-2 18"/></svg>',
    'check': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    'more': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
    'collapse': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19V5"/><path d="m13 6-6 6 6 6"/><path d="M7 12h14"/></svg>',
    'chev': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    'open': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    'target': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    'terminal': '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>',
}


def ic(n, s=16):
    return ICON[n].format(s=s)


# ---------------------------------------------------------------- the fleet

FLEET = [
    dict(h='max', repo='rt', branch='main', st='live', title='max', pane='wAR:p3', seen='seen 12s ago', cwd='~/Documents/GitHub/repo-tools', rooms=['rt'], dms=['stan', 'jay', 'kai', 'wren', 'gail']),
    dict(h='edie', repo='skills', branch='main', st='live', title='Pipeline iteration loop', pane='wBP:p1', seen='seen 2m ago', cwd='~/Documents/GitHub/mattstack-skills', rooms=['skills'], dms=['stan']),
    dict(h='jay', repo='boxscore', branch='feat/metrics-hardening', st='live', title='Boxscore mattstack integration', pane='wBT:p1', seen='seen 40s ago', cwd='~/Documents/GitHub/boxscore/.claude/worktrees/metrics-hardening', rooms=['boxscore'], dms=['max']),
    dict(h='remy', repo='rt', branch='main', st='idle', title=None, pane=None, seen='idle 16h', cwd='~/Documents/GitHub/repo-tools', rooms=['rt'], dms=['kai']),
    dict(h='gail', repo='board', branch='main', st='offline', title=None, pane=None, seen='signed out 3m ago', cwd='~/Documents/GitHub/board', rooms=[], dms=['max']),
    dict(h='kai', repo='rt', branch='main', st='offline', title=None, pane=None, seen='signed out 16h ago', cwd='~/Documents/GitHub/repo-tools', rooms=['rt'], dms=['max', 'remy']),
    dict(h='ida', repo='rt', branch='main', st='offline', title=None, pane=None, seen='signed out 15h ago', cwd='~/Documents/GitHub/repo-tools', rooms=['rt'], dms=[]),
    dict(h='jax', repo='rt', branch='goodwinmattheweric/rt-96-provision-blocks-on-claim-time-ready-steps-run-them-async', st='offline', title=None, pane=None, seen='signed out 23h ago', cwd='~/.mattstack/rt/worktrees/m4ttstack-rt/proud-marble', rooms=['rt'], dms=[]),
    dict(h='sid', repo='rt', branch='main', st='offline', title=None, pane=None, seen='signed out 23h ago', cwd='~/Documents/GitHub/repo-tools', rooms=['rt'], dms=[]),
    dict(h='meg', repo='skills', branch='main', st='offline', title=None, pane=None, seen='signed out 23h ago', cwd='~/Documents/GitHub/matt-skills', rooms=['skills'], dms=[]),
    dict(h='stan', repo='console', branch='main', st='offline', title=None, pane=None, seen='signed out 17h ago', cwd='~/Documents/GitHub/console', rooms=['console'], dms=['max', 'edie']),
    dict(h='elsa', repo='rt', branch='main', st='offline', title=None, pane=None, seen='signed out 20h ago', cwd='~/Documents/GitHub/repo-tools', rooms=['rt'], dms=[]),
    dict(h='wren', repo='rt', branch='main', st='offline', title=None, pane=None, seen='signed out 20h ago', cwd='~/Documents/GitHub/repo-tools', rooms=['rt'], dms=['max']),
]
BY = {b['h']: b for b in FLEET}
STATUS_WORD = {'live': 'working', 'idle': 'idle', 'offline': 'offline'}
ROOMS = [('rt', 1, 155, True), ('skills', 0, 9, False), ('console', 0, 3, False), ('boxscore', 0, 6, False)]
ROOM_BADGE = {r: (m, u) for r, m, u, _ in ROOMS}
DMS = [('max', 'stan', 4), ('jay', 'max', 3), ('edie', 'stan', 14), ('kai', 'max', 1), ('max', 'wren', 8), ('kai', 'remy', 102), ('gail', 'max', 6)]
LAST = {
    ('max', 'stan'): 'stan: holding the console settings page until 2.8.1 lands',
    ('kai', 'max'): 'max: fixed on main, re-run your checks',
    ('max', 'wren'): 'wren: PR #175 is green again, merging',
    ('kai', 'remy'): 'remy: tail died again at 03:12, restarting the daemon',
    ('gail', 'max'): 'gail: launch note auto-grow is in, PR #17',
}

_HUE_ROTATION = ['var(--purple)', 'var(--cyan)', 'var(--ok)', 'var(--warn)', 'var(--bad)']


def speaker_hue(handle):
    if handle == 'matt':
        return 'var(--accent)'
    h = 0
    units = handle.encode('utf-16-le')
    for i in range(0, len(units), 2):
        cu = units[i] | (units[i + 1] << 8)
        h = (h * 31 + cu) & 0xFFFFFFFF
        if h >= 0x80000000:
            h -= 0x100000000
    index = ((h % len(_HUE_ROTATION)) + len(_HUE_ROTATION)) % len(_HUE_ROTATION)
    return _HUE_ROTATION[index]


def sprite(handle, hue):
    """A 5x5 mirrored bitmap seeded by the handle, standing in for the invadrs avatar the app draws."""
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


def hpill(h, size='13.6px'):
    hue = speaker_hue(h)
    return (f'<span class="h hpill row" style="color: {hue}; background: color-mix(in srgb, {hue} var(--wash), transparent); '
            f'font-size: {size}; font-weight: 600;">{sprite(h, hue)}<span>{h}</span></span>')


def doing(b):
    """The task line and where it came from: herdr title, else the branch when it is not main, else the worktree folder."""
    if b['title'] and b['title'] != b['h']:
        return b['title'], 'title'
    br = b['branch']
    if br != 'main':
        short = br.split('/', 1)[1] if br.startswith('goodwinmattheweric/') else br
        return short, 'branch'
    return f"{b['cwd'].rstrip('/').split('/')[-1]} · main", 'path'


def doing_span(b, extra_style=''):
    text, kind = doing(b)
    cls = 'doing path' if kind == 'path' else 'doing'
    return f'<span class="{cls}" style="{extra_style}">{text}</span>'


def repo_token(r):
    return f'<span class="xs muted truncate" style="flex: none;"><span style="font-size: 12px; margin: 0 3px;">•</span>{r}</span>'


def dot(st, title=''):
    t = f' title="{title}"' if title else ''
    return f'<span class="dot {st}"{t}></span>'


def sect(label, count=None):
    c = f'<span class="xs muted">{count}</span>' if count is not None else ''
    return f'<div class="sect"><span class="lbl">{label}</span>{c}</div>'


# ---------------------------------------------------------------- chrome

def head():
    return ('<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n'
            '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">\n'
            '  <style>' + CSS + EXTRA_CSS + '  </style>\n</helmet>\n')


def tail(w, h):
    return ('</x-dc>\n<script data-dc-script data-props=\'{"dark":{"editor":"boolean","default":false,"section":"Theme"},"$preview":{"width":' + str(w) + ',"height":' + str(h) + '}}\'>\n'
            'class Component extends DCLogic {\n  renderVals() {\n    return { schemeClass: this.props.dark ? \'dark\' : \'\' };\n  }\n}\n</script>\n</body>\n</html>\n')


def rail(active='rooms'):
    btn = lambda n, on: f'<button class="aicon{" on" if on else ""}" aria-label="{n}">{ic(n)}</button>'
    return ('  <div style="width: 68px; flex: none; background: var(--bg1); border-right: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; padding: 11.2px 0;">\n'
            f'    <button class="aicon" aria-label="Toggle rail">{ic("panel")}</button>\n'
            '    <div style="height: 14.4px;"></div>\n'
            f'    <div class="stack" style="gap: 4.8px; align-items: center;">{btn("inbox", active == "inbox")}{btn("rooms", active == "rooms")}</div>\n'
            '    <div style="flex: 1;"></div>\n'
            f'    <button class="aicon" aria-label="Color scheme">{ic("moon")}</button>\n'
            '  </div>\n')


def header():
    return ('    <div class="row" style="height: 64px; flex: none; padding: 0 9.6px; background: var(--bg1); border-bottom: 1px solid var(--border); gap: 9.6px;">\n'
            '      <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14.4" fill="#ff84ad"/><g transform="translate(7.8 11.25) scale(2)" fill="#1d1830"><path d="M6.5 2h11A4.5 4.5 0 0 1 22 6.5v5a4.5 4.5 0 0 1-4.5 4.5H13l-8.5 6.5L6 16a4.5 4.5 0 0 1-4-4.5v-5A4.5 4.5 0 0 1 6.5 2z"/></g></svg>\n'
            '      <span style="font-size: 22px; font-weight: 700; line-height: 1;">chat</span>\n'
            '    </div>\n')


def pagebar(icon, title, chips, right):
    return ('    <div class="row" style="height: 64px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 9.6px;">\n'
            f'      <span class="muted">{ic(icon, 18)}</span>\n'
            f'      <span class="truncate" style="font-size: 20px; font-weight: 700; line-height: 1.35;">{title}</span>\n'
            '      <div style="width: 4.8px;"></div>\n'
            f'      {chips}\n'
            '      <div style="flex: 1;"></div>\n'
            f'      {right}\n'
            '    </div>\n')


def btn(label, icon=None, badge=None, primary=False):
    i = f'{ic(icon, 14)}' if icon else ''
    b = f'<span class="unread">{badge}</span>' if badge is not None else ''
    style = 'background: var(--accent-deep); border-color: var(--accent-deep); color: var(--accent-on);' if primary else 'background: var(--bg1); color: var(--fg);'
    return (f'<button class="row" style="gap: 6px; height: 30px; padding: 0 9.6px; border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 12.16px; cursor: pointer; {style}">'
            f'{i}<span>{label}</span>{b}</button>')


def menu_btn():
    return f'<button class="menu" aria-label="Actions">{ic("more")}</button>'


def sidebar_toggle():
    return ('        <button class="row" aria-label="Toggle sidebar" style="position: absolute; top: 50%; right: 0; transform: translate(50%, -50%); width: 34px; height: 34px; justify-content: center; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; color: var(--fg); cursor: pointer; padding: 0;">'
            f'{ic("collapse", 18)}</button>\n')


def shell(active, bar, sidebar, content, w=1440, h=900):
    side = ''
    if sidebar is not None:
        side = ('      <div class="stack" style="width: 244px; flex: none; background: var(--bg2); border-right: 1px solid var(--border); padding: 11.2px 6px; overflow: hidden; position: relative;">\n'
                + sidebar + sidebar_toggle() + '      </div>\n')
    return (head()
            + f'\n<div class="app {{{{schemeClass}}}}" style="width: {w}px; height: {h}px; display: flex; overflow: hidden;">\n'
            + rail(active)
            + '  <div class="stack" style="flex: 1; min-width: 0;">\n'
            + header() + bar
            + f'    <div style="display: flex; flex: 1; min-height: 0; height: {h - 128}px;">\n'
            + side
            + '      <div class="stack" style="flex: 1; min-width: 0; min-height: 0;">\n'
            + content
            + '      </div>\n    </div>\n  </div>\n</div>\n'
            + tail(w, h))


# ---------------------------------------------------------------- sidebars

def room_badges(room):
    m, u = ROOM_BADGE.get(room, (0, 0))
    out = ''
    if m:
        out += f'<span class="mention" aria-label="{m} mention">@{m}</span>'
    if u:
        out += f'<span class="unread" aria-label="{u} unread">{u}</span>'
    return out


def ws_row(b, on=False):
    st = b['st']
    return (f'<div class="ws{" on" if on else ""}">{dot(st, STATUS_WORD[st] + " · " + b["seen"])}'
            f'<span class="h">{b["h"]}</span>{doing_span(b, "flex: 1;")}</div>')


def fleet_tree(selected=None):
    """Rooms and the fleet as one tree: each repo room heads the workstreams inside it."""
    live = sum(1 for b in FLEET if b['st'] != 'offline')
    out = ['<div class="stack" style="width: 100%; gap: 2px;">',
           f'<div class="row" style="justify-content: space-between; padding: 0 9.6px 6px;"><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">FLEET</span><span class="xs muted">{live} on · {len(FLEET) - live} off</span></div>']
    order = ['rt', 'skills', 'boxscore', 'board', 'console']
    for repo in order:
        has_room = repo in ROOM_BADGE
        members = [b for b in FLEET if b['repo'] == repo]
        on = [b for b in members if b['st'] != 'offline']
        off = [b for b in members if b['st'] == 'offline']
        active = (repo == 'rt' and selected is None)
        if has_room:
            out.append(f'<div class="room{" on" if active else ""}"><span class="hash">{ic("hash", 14)}</span><span class="truncate" style="font-weight: 600; flex: 1;">{repo}</span>{room_badges(repo)}</div>')
        else:
            out.append(f'<div class="room"><span class="hash" style="width: 14px;"></span><span class="truncate grp" style="flex: 1;">{repo}</span><span class="xs muted">no room</span></div>')
        for b in on:
            out.append(ws_row(b, on=(b['h'] == selected)))
        if off:
            if len(off) == 1:
                out.append(ws_row(off[0], on=(off[0]['h'] == selected)))
            else:
                out.append(f'<div class="ws more"><span class="dot offline"></span><span>{len(off)} signed out · {" ".join(x["h"] for x in off)}</span></div>')
    out.append('<div class="sect" style="padding: 10px 9.6px 4px;"><span class="lbl">DIRECT</span></div>')
    for a, c, n in (DMS[0], DMS[1], DMS[2], DMS[5]):
        out.append(dm_entry(a, c, n))
    out.append('<div class="ws more" style="padding-left: 9.6px;"><span>3 more · kai ↔ max 1, max ↔ wren 8, gail ↔ max 6</span></div>')
    out.append('</div>')
    return '\n        '.join(out) + '\n'


def dm_label(a, c):
    """The second line of a DM entry: the two ends' tasks when either has one, else the last message."""
    ba, bc = BY[a], BY[c]
    ta, ka = doing(ba)
    tc, kc = doing(bc)
    if ka == 'title' or kc == 'title':
        short = lambda t, k, b: (t if k == 'title' else b['repo'])
        return f'{short(ta, ka, ba)} ↔ {short(tc, kc, bc)}'
    return LAST.get((a, c), f'{ba["repo"]} · no task line on either end')


def dm_entry(a, c, n, on=False):
    badge = f'<span class="unread" aria-label="{n} unread">{n}</span>' if n else ''
    return (f'<div class="dm2{" on" if on else ""}"><div class="row" style="gap: 4px;"><span class="pair" style="flex: 1;"><span class="truncate sm" style="font-weight: 600;">{a}</span><span class="arrows">↔</span><span class="truncate sm" style="font-weight: 600;">{c}</span></span>{badge}</div>'
            f'<span class="doing" style="padding-left: 1px;">{dm_label(a, c)}</span></div>')


def rooms_sidebar():
    """Today's sidebar, with the DM entries repaired."""
    out = ['<div class="stack" style="width: 100%; gap: 2px;">',
           f'<div class="row" style="justify-content: space-between; padding: 0 9.6px 6px;"><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">ROOMS</span><span class="xs muted">{len(ROOMS)} +</span></div>']
    for r, m, u, active in ROOMS:
        out.append(f'<div class="room{" on" if active else ""}"><span class="hash">{ic("hash", 14)}</span><span class="truncate" style="{"font-weight: 600; " if active else ""}flex: 1;">{r}</span>{room_badges(r)}</div>')
    out.append('<div class="sect" style="padding: 10px 9.6px 4px;"><span class="lbl">DIRECT</span></div>')
    for a, c, n in DMS:
        out.append(dm_entry(a, c, n))
    out.append('</div>')
    return '\n        '.join(out) + '\n'


# ---------------------------------------------------------------- inbox pieces

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


def inbox_card(c):
    b = BY[c['h']]
    ctx = f'<span class="ctx{" dm" if c["kind"] == "dm" else ""}">{c["where"]}</span>'
    return (f'<div class="card2{" on" if c["on"] else ""}">'
            f'<div class="row" style="gap: 7.2px;">{hpill(c["h"], "12.16px")}{repo_token(b["repo"])}{doing_span(b, "flex: 1;")}<span class="xs muted" style="flex: none;">{c["when"]}</span></div>'
            f'<div class="lead">{c["lead"]}</div>'
            f'<div class="row" style="gap: 7.2px;">{ctx}<span class="xs muted">{c["age"]}</span><div style="flex: 1;"></div>'
            f'<span class="xs" style="font-weight: 600; color: var(--accent);">open</span><span class="xs muted">·</span><span class="xs" style="font-weight: 600; color: var(--accent);">mark read</span></div>'
            '</div>')


def inbox_list(width=560):
    cards = [f'<div class="stack" style="width: {width}px; flex: none; padding: 11.2px 14.4px; gap: 6px; overflow: auto; background: var(--bg3); border-right: 1px solid var(--border);">',
             sect('NEEDS YOU', len(NEEDS))]
    cards += [inbox_card(c) for c in NEEDS]
    cards.append('<div class="sect"><span class="lbl">OPEN ASKS</span><span class="xs muted">2 · @here, nobody claimed</span></div>')
    cards += [inbox_card(c) for c in ASKS]
    cards.append(sect('EVERYTHING ELSE'))
    cards.append('<div class="row" style="gap: 7.2px; flex-wrap: wrap; padding: 2px 0;">'
                 '<span class="ctx">#rt 152</span><span class="ctx">#skills 9</span><span class="ctx">#boxscore 5</span><span class="ctx">#console 3</span><span class="ctx dm">7 DMs · 136</span>'
                 '<div style="flex: 1;"></div><span class="xs" style="font-weight: 600; color: var(--accent);">mark all read</span></div>')
    cards.append('<span class="xs muted" style="padding-top: 2px;">Nothing here mentions you or is waiting on an answer. Open a room from the rail when you want the full record.</span>')
    cards.append('</div>')
    return '\n'.join(cards)


def reader():
    b = BY['jay']
    return ('<div class="stack" style="flex: 1; min-width: 0; background: var(--bg1);">'
            '<div class="row" style="height: 40px; flex: none; padding: 0 20px; gap: 7.2px; border-bottom: 1px solid var(--border-soft);">'
            f'<span class="ctx">#boxscore</span><span class="xs muted">today · shown with the message before it</span><div style="flex: 1;"></div>'
            f'<span class="row xs" style="gap: 4px; font-weight: 600; color: var(--accent);">{ic("open", 12)}open #boxscore</span></div>'
            '<div class="stack" style="flex: 1; min-height: 0; overflow: auto; padding: 8px 20px 0;"><div class="col">'
            '<div class="day">earlier in #boxscore</div>'
            '<div class="msg context">'
            f'<div class="hdr">{hpill("max")}{repo_token("rt")}{doing_span(BY["max"])}<span class="xs muted">13:41</span></div>'
            '<div class="prose"><p><span class="at">@jay</span> when you pick metrics-hardening up: rt 2.8.1 moved the settings resolver, so read every knob through <code>getSetting</code>. Details in our DM.</p></div>'
            '</div>'
            '<div class="divider" aria-label="the message you opened">the message you opened</div>'
            '<div class="msg">'
            f'<div class="hdr">{hpill("jay")}{repo_token("boxscore")}{doing_span(b)}<span class="xs muted">14:51</span></div>'
            '<div class="prose"><p><span class="at me">@matt</span> metrics-hardening is ready for review: PR #12, 31 tests green.</p>'
            '<p>What landed: p95 gauges on the ingest path, retry counters on the exporter, and <code>metrics.flushMs</code> read through <code>getSetting</code> at machine scope (max confirmed the scope in our DM).</p>'
            '<p>Want the dashboard split into its own PR, or keep it in this one?</p></div>'
            '</div>'
            '</div></div>'
            '<div class="stack" style="padding: 0 20px 11.2px;"><div class="col">'
            '<div class="row" style="gap: 7.2px; padding-top: 9.6px; border-top: 1px solid var(--border-soft); margin-top: 4.8px;">'
            '<div class="input focus" style="flex: 1;"><span class="placeholder">Reply in #boxscore — @jay is already tagged</span><div style="flex: 1;"></div><span class="kbd">↵ send</span><span class="kbd">⇧↵ newline</span></div>'
            f'<button class="aicon filled" style="width: 34px; height: 34px;" aria-label="Send">{ic("send")}</button></div>'
            '<div class="row" style="gap: 4.8px; padding-top: 4.8px;"><span class="xs muted">posting as</span><span class="xs" style="font-weight: 600;">matt</span><span class="xs muted">· replying marks this read</span></div>'
            '</div></div>'
            '</div>')


def inbox_bar():
    chips = ('<span class="chip" style="color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent);">@ 2 need you</span>'
             '<span class="chip live"><span class="dot live"></span>2 open asks</span>'
             '<span class="chip">168 unread elsewhere</span>')
    right = btn('mark all read', 'check', 172) + '<div style="width: 7.2px;"></div>' + menu_btn()
    return pagebar('inbox', 'Inbox', chips, right)


# ---------------------------------------------------------------- A: inbox + fleet

def main_inbox():
    content = f'<div style="display: flex; flex: 1; min-height: 0; align-items: stretch;">{inbox_list()}{reader()}</div>\n'
    return shell('inbox', inbox_bar(), fleet_tree(), content)


# ---------------------------------------------------------------- D: inbox only

def fleet_strip():
    order = ['rt', 'skills', 'boxscore', 'board', 'console']
    groups = []
    for repo in order:
        members = [b for b in FLEET if b['repo'] == repo]
        on = [b for b in members if b['st'] != 'offline']
        off = [b for b in members if b['st'] == 'offline']
        chips = ''.join(f'<span class="wchip">{dot(b["st"])}{b["h"]}</span>' for b in on)
        if off:
            chips += f'<span class="wchip off">{dot("offline")}{len(off)} off</span>' if len(off) > 1 else f'<span class="wchip off">{dot("offline")}{off[0]["h"]}</span>'
        groups.append(f'<span class="g"><span class="lbl">{repo}</span>{room_badges(repo)}{chips}</span>')
    return ('<div class="strip">' + ''.join(groups) + '<div style="flex: 1;"></div>'
            f'<span class="row xs muted" style="gap: 4px;">{ic("users", 12)}4 on · 9 off</span></div>\n')


def inbox_only():
    content = fleet_strip() + f'<div style="display: flex; flex: 1; min-height: 0; align-items: stretch;">{inbox_list(620)}{reader()}</div>\n'
    return shell('inbox', inbox_bar(), None, content)


# ---------------------------------------------------------------- B: workstream first

FEED = [
    dict(h='jay', where='#boxscore', kind='room', t='13:58', body='<p>picked up metrics-hardening in a worktree. plan: harden the ingest metrics first (p95 gauges, retry counters), then split the dashboard.</p>'),
    dict(h='max', where='jay ↔ max', kind='dm', t='14:20', body='<p><span class="at">@jay</span> before you touch the exporter: rt 2.8.1 moved the settings resolver. read <code>metrics.flushMs</code> through <code>getSetting</code>, never the jsonc.</p>'),
    dict(h='jay', where='jay ↔ max', kind='dm', t='14:24', body='<p>already on <code>getSetting</code>. one question: is <code>metrics.flushMs</code> team or machine scope?</p>'),
    dict(h='max', where='jay ↔ max', kind='dm', t='14:31', body='<p>machine. it is a per-host tuning knob.</p>'),
    dict(h='jay', where='#boxscore', kind='room', t='14:51', body='<p><span class="at me">@matt</span> metrics-hardening is ready for review: PR #12, 31 tests green.</p><p>Want the dashboard split into its own PR, or keep it in this one?</p>'),
]


def feed_msg(m):
    b = BY[m['h']]
    ctx = f'<span class="ctx{" dm" if m["kind"] == "dm" else ""}">{m["where"]}</span>'
    return (f'<div class="msg"><div class="hdr">{hpill(m["h"])}{repo_token(b["repo"])}{doing_span(b)}{ctx}<span class="xs muted">{m["t"]}</span></div>'
            f'<div class="prose">{m["body"]}</div></div>')


def about_panel():
    b = BY['jay']
    kv = ('<div class="kv">'
          '<span class="k">doing</span><span class="sm">Boxscore mattstack integration</span>'
          '<span class="k">repo</span><span class="sm">boxscore · feat/metrics-hardening</span>'
          '<span class="k">pane</span><span class="sm">wBT:p1 · working</span>'
          f'<span class="k">path</span><span class="xs muted truncate path">&lrm;{b["cwd"]}</span>'
          '<span class="k">since</span><span class="xs muted">signed in 1h 22m ago · seen 40s ago</span>'
          '<span class="k">rooms</span><div class="row" style="gap: 3px;"><span class="tag">boxscore</span><span class="tag dm">max</span></div>'
          '</div>')
    talks = ('<div class="stack" style="gap: 4px;">'
             f'<div class="member" style="padding: 4px 0;">{dot("live")}<div class="stack" style="gap: 1px; flex: 1; min-width: 0;"><div class="row" style="gap: 0; align-items: baseline;"><span class="sm" style="font-weight: 600;">max</span>{repo_token("rt")}</div>{doing_span(BY["max"])}</div><span class="unread">3</span></div>'
             '</div>')
    return ('<div class="stack roster-panel" style="gap: 8px; overflow: auto;">'
            f'<div class="row" style="gap: 6px; padding-bottom: 2px;"><span class="muted">{ic("target", 14)}</span><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">THIS WORKSTREAM</span></div>'
            f'<div class="about">{kv}<div style="height: 1px; background: var(--border-soft);"></div>'
            f'<div class="row" style="gap: 7.2px;">{btn("focus pane", "terminal")}{btn("DM jay")}</div></div>'
            f'<div class="row" style="gap: 6px; padding-top: 6px;"><span class="muted">{ic("users", 14)}</span><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">IN CONVERSATION WITH</span></div>'
            + talks +
            '<div class="xs muted" style="padding-top: 6px;">Everything jay posted, and everything addressed to jay, across #boxscore and its DM. The room itself is one click up the tree.</div>'
            '</div>')


def workstreams():
    chips = ('<span class="chip live"><span class="dot live"></span>working</span>'
             f'<span class="chip">{sprite("jay", speaker_hue("jay"))}<span style="margin-left: 4px;">jay</span></span>'
             '<span class="chip">boxscore · feat/metrics-hardening</span>'
             '<span class="chip">pane wBT:p1</span>')
    right = btn('mark read', 'check', 3) + '<div style="width: 7.2px;"></div>' + menu_btn()
    bar = pagebar('target', 'Boxscore mattstack integration', chips, right)
    msgs = '\n'.join(feed_msg(m) for m in FEED)
    transcript = ('<div class="stack" style="flex: 1; min-width: 0; padding: 11.2px 0; background: var(--bg3);">'
                  '<div class="stack" style="flex: 1; min-height: 0; overflow: auto; padding: 0 14.4px 0 31.4px; position: relative;"><div class="col">'
                  '<div class="edge xs muted">jay signed in 13:58 · this is the whole feed</div><div class="day">Today</div>'
                  + msgs +
                  '</div></div>'
                  '<div class="stack" style="padding: 0 14.4px 0 31.4px;"><div class="col">'
                  '<div class="row" style="gap: 7.2px; padding-top: 9.6px; border-top: 1px solid var(--border-soft); margin-top: 4.8px;">'
                  '<div class="input" style="flex: 1;"><span class="placeholder">Message jay — lands in jay ↔ matt</span><div style="flex: 1;"></div><span class="kbd">↵ send</span><span class="kbd">⇧↵ newline</span></div>'
                  f'<button class="aicon filled" style="width: 34px; height: 34px;" aria-label="Send">{ic("send")}</button></div>'
                  '<div class="row" style="gap: 4.8px; padding-top: 4.8px;"><span class="xs muted">posting as</span><span class="xs" style="font-weight: 600;">matt</span></div>'
                  '</div></div></div>')
    content = f'<div style="display: flex; flex: 1; min-height: 0; align-items: stretch;">{transcript}{about_panel()}</div>\n'
    return shell('rooms', bar, fleet_tree(selected='jay'), content)


# ---------------------------------------------------------------- C: classic, repaired

RT_MSGS = [
    dict(h='wren', t='yesterday 20:12', fold=4, first='<p><span class="at">@kai</span> <span class="at">@max</span> main is red on typecheck since #174 (f7880316): <code>lib/setup/tests/validators-rt-health.test.ts:71</code> references NOOP_FZF, which is not defined anywhere.</p>'),
    dict(h='max', t='21:37', fold=2, first='<p><span class="at">@here</span> checks CI on main is green again from 2aeb61f7: the NOOP_FZF typecheck red was my tool.rt test, and docs:check was the generated git/commit reference drifting.</p>'),
    dict(h='max', t='23:34', fold=9, first='<p><span class="at">@here</span> Release-relevant, for whoever cuts 2.8.1: the first GUI create walkthrough of mattstack.app on a clean macOS 26 guest is green end to end tonight.</p>'),
]


def folded_msg(m):
    b = BY[m['h']]
    return (f'<div class="msg"><div class="hdr">{hpill(m["h"])}{repo_token(b["repo"])}{doing_span(b)}<span class="xs muted">{m["t"]}</span></div>'
            f'<div class="prose">{m["first"]}</div>'
            f'<div class="foldrow"><span class="tri"></span>{m["fold"]} more lines</div></div>')


def repaired_roster():
    rows = []
    for st, label in (('live', 'WORKING'), ('idle', 'IDLE')):
        members = [b for b in FLEET if b['st'] == st]
        rows.append(sect(label, len(members)))
        for b in members:
            rows.append(f'<div class="member">{dot(b["st"], STATUS_WORD[st] + " · " + b["seen"])}<div class="stack" style="gap: 1px; flex: 1; min-width: 0;">'
                        f'<div class="row" style="gap: 0; align-items: baseline;"><span class="sm" style="font-weight: 600;">{b["h"]}</span>{repo_token(b["repo"])}</div>{doing_span(b)}</div></div>')
    off = [b for b in FLEET if b['st'] == 'offline']
    rows.append(f'<div class="sect"><span class="lbl">OFFLINE · LAST 24H</span><span class="xs muted">{len(off)}</span></div>')
    for b in off:
        rows.append(f'<div class="member" style="padding: 5px 0;">{dot("offline")}<div class="stack" style="gap: 1px; flex: 1; min-width: 0;">'
                    f'<div class="row" style="gap: 0; align-items: baseline;"><span class="sm" style="font-weight: 600; color: var(--muted-text);">{b["h"]}</span>{repo_token(b["repo"])}</div>'
                    f'<span class="xs muted">{b["seen"]}</span></div></div>')
    return ('<div class="stack roster-panel">'
            f'<div class="row" style="justify-content: space-between; padding-bottom: 4.8px; flex: none;"><div class="row" style="gap: 6px;"><span class="muted">{ic("users", 14)}</span><span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">BUDDIES</span></div></div>'
            '<div class="stack" style="flex: 1; min-height: 0; overflow: auto;">' + '\n'.join(rows) + '</div></div>')


def repaired():
    chips = ('<span class="chip">1 in room</span><span class="chip live"><span class="dot live"></span>1 working: max</span>'
             '<span class="chip offline"><span class="dot offline"></span>7 offline</span><span class="chip">wakes: mention</span>')
    right = btn('add agents', 'users') + '<div style="width: 7.2px;"></div>' + btn('mark read', 'check', 155) + '<div style="width: 7.2px;"></div>' + \
        ('<div class="row" style="width: 168px; height: 30px; padding: 0 9.6px; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px;"><span style="font-size: 12.16px;">join order</span><div style="flex: 1;"></div>'
         f'<span class="muted">{ic("chev", 14)}</span></div>')
    bar = pagebar('hash', 'rt', chips, right)
    b = BY['max']
    latest = (f'<div class="msg"><div class="hdr">{hpill("max")}{repo_token("rt")}{doing_span(b)}<span class="xs muted">14:03</span></div>'
              '<div class="prose"><p>heads-up: main tsc is red since 85f18ee8 (picker: action rows). <code>commands/run.ts:106</code> and <code>run-picker-rows.test.ts</code> use <code>PickRow.kind</code> / <code>.glyph</code> but <code>lib/ui/protocol.ts</code> PickRow has neither field (only the PickRowKind type landed).</p>'
              '<p>Whoever owns the picker lane: please add the two fields or hold run.ts back. Not touching it from my lane (audit corrections).</p></div>'
              '<div class="row" style="gap: 7.2px; margin-top: 8px;"><span class="ctx" style="color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent);">@here · unclaimed 1h 17m</span></div></div>')
    msgs = '\n'.join(folded_msg(m) for m in RT_MSGS)
    transcript = ('<div class="stack" style="flex: 1; min-width: 0; padding: 11.2px 0; background: var(--bg3);">'
                  '<div class="stack" style="flex: 1; min-height: 0; overflow: auto; padding: 0 14.4px 0 31.4px; position: relative;"><div class="col">'
                  '<div class="edge xs muted">125 older messages · load older</div><div class="day">Yesterday</div>'
                  + msgs +
                  '<div class="day">Today</div>' + latest +
                  '</div></div>'
                  '<div class="stack" style="padding: 0 14.4px 0 31.4px;"><div class="col">'
                  '<div class="row" style="gap: 7.2px; padding-top: 9.6px; border-top: 1px solid var(--border-soft); margin-top: 4.8px;">'
                  '<div class="input" style="flex: 1;"><span class="placeholder">Message #rt (@ to mention)</span><div style="flex: 1;"></div><span class="kbd">↵ send</span><span class="kbd">⇧↵ newline</span></div>'
                  f'<button class="aicon filled" style="width: 34px; height: 34px;" aria-label="Send">{ic("send")}</button></div>'
                  '<div class="row" style="gap: 4.8px; padding-top: 4.8px;"><span class="xs muted">posting as</span><span class="xs" style="font-weight: 600;">matt</span></div>'
                  '</div></div></div>')
    content = f'<div style="display: flex; flex: 1; min-height: 0; align-items: stretch;">{transcript}{repaired_roster()}</div>\n'
    return shell('rooms', bar, rooms_sidebar(), content)


# ---------------------------------------------------------------- the identity sheet

def sheet_block(title, blurb, inner, width=None):
    w = f'width: {width}px;' if width else ''
    return (f'<div class="stack" style="gap: 8px; {w}">'
            f'<div class="stack" style="gap: 2px;"><span class="sheet-h">{title}</span><span class="sheet-p">{blurb}</span></div>'
            f'<div class="card" style="padding: 9.6px 11.2px;">{inner}</div></div>')


def identity():
    def row(b, note):
        st = b['st']
        name_style = 'color: var(--muted-text);' if st == 'offline' else ''
        second = doing_span(b) if st != 'offline' else f'<span class="xs muted">{b["seen"]}</span>'
        return (f'<div class="member" style="align-items: center;">{dot(st)}<div class="stack" style="gap: 1px; flex: 1; min-width: 0;">'
                f'<div class="row" style="gap: 0; align-items: baseline;"><span class="sm" style="font-weight: 600; {name_style}">{b["h"]}</span>{repo_token(b["repo"])}</div>{second}</div>'
                f'<span class="xs muted" style="flex: none; width: 190px; text-align: right;">{note}</span></div>')

    rows = ''.join([
        row(BY['edie'], 'herdr title'),
        row(BY['jay'], 'herdr title; branch lives in the card'),
        row(BY['max'], 'title was “max”: folder · branch instead'),
        row(BY['jax'] | {'st': 'live', 'seen': 'seen 5s ago'}, 'no title: branch, prefix stripped'),
        row(BY['remy'], 'pane closed: idle, nothing else known'),
        row(BY['gail'], 'offline: age only, as today'),
    ])
    rows_block = sheet_block('A buddy row, six states', 'One line per buddy plus what it is doing. The task line comes from the live herdr join, so it falls back honestly when the pane title is the handle or the pane is gone.', rows, 560)

    before = f'<div class="hdr" style="margin: 0;">{hpill("max")}{repo_token("rt")}<span class="xs muted">14:03</span></div>'
    after = ''.join(f'<div class="hdr" style="margin: 0;">{hpill(h)}{repo_token(BY[h]["repo"])}{doing_span(BY[h])}<span class="xs muted">{t}</span></div>' for h, t in (('edie', '15:02'), ('jay', '14:51'), ('max', '14:03')))
    author_inner = (f'<div class="stack" style="gap: 10px;"><div class="stack" style="gap: 4px;"><span class="xs muted">today</span>{before}</div>'
                    f'<div style="height: 1px; background: var(--border-soft);"></div><div class="stack" style="gap: 8px;"><span class="xs muted">proposed</span>{after}</div></div>')
    author_block = sheet_block('The author line', 'Handle, repo, task, time. The task uses the same fallback chain, so max reads as folder · branch until the pane gets a real title.', author_inner, 560)

    dm_before = ('<div class="room"><span class="pair" style="flex: 1;"><span class="truncate sm">kai</span><span class="arrows">↔</span><span class="truncate sm">remy</span></span><span class="unread">102</span></div>'
                 '<div class="room"><span class="pair" style="flex: 1;"><span class="truncate sm">edie</span><span class="arrows">↔</span><span class="truncate sm">stan</span></span><span class="unread">14</span></div>')
    dm_after = dm_entry('edie', 'stan', 14) + dm_entry('jay', 'max', 3) + dm_entry('kai', 'remy', 102)
    dm_inner = (f'<div class="stack" style="gap: 10px;"><div class="stack" style="gap: 2px;"><span class="xs muted">today</span>{dm_before}</div>'
                f'<div style="height: 1px; background: var(--border-soft);"></div><div class="stack" style="gap: 2px;"><span class="xs muted">proposed</span>{dm_after}</div></div>')
    dm_block = sheet_block('A DM entry', 'The pair stays (it is how you address them); a second line says what the two ends are doing. When neither end has a task line, it shows the last message instead.', dm_inner, 300)

    b = BY['jay']
    card = ('<div class="pop stack" style="gap: 6px; width: 300px; padding: 7.2px;">'
            f'<div class="row" style="gap: 7.2px; justify-content: space-between;"><div class="row" style="gap: 7.2px;">{dot("live")}{hpill("jay")}</div><span class="status live">working</span></div>'
            '<div class="sm" style="font-weight: 500;">Boxscore mattstack integration</div>'
            '<div style="height: 1px; background: var(--border-soft);"></div>'
            '<div class="kv">'
            '<span class="k">repo</span><span class="sm">boxscore</span>'
            '<span class="k">where</span><span class="sm">feat/metrics-hardening · pane wBT:p1</span>'
            f'<span class="k">path</span><span class="xs muted truncate path">&lrm;{b["cwd"]}</span>'
            '<span class="k">seen</span><span class="xs muted">40s ago · signed in 1h 22m ago</span>'
            '<span class="k">rooms</span><div class="row" style="gap: 3px;"><span class="tag">boxscore</span><span class="tag dm">max</span></div>'
            '</div>'
            '<div style="height: 1px; background: var(--border-soft);"></div>'
            f'<div class="row" style="gap: 7.2px;">{btn("focus pane", "terminal")}{btn("@mention")}{btn("DM")}</div>'
            '</div>')
    card_block = sheet_block('The hover card', 'Today\'s card with the task added as its second line and focus pane promoted to the first button. Same card behind every handle, on every direction.', card, 300)

    body = (head()
            + '\n<div class="app {{schemeClass}} grid" style="width: 960px; height: 1000px; padding: 24px; display: flex; flex-direction: column; gap: 20px; overflow: hidden;">'
            '<div class="stack" style="gap: 2px;"><span style="font-size: 20px; font-weight: 700;">Who is this, at a glance</span>'
            '<span class="sheet-p">The pieces every direction shares. Sizes and colours are the app\'s; only the task line and the second lines are new.</span></div>'
            f'<div style="display: flex; gap: 20px; align-items: flex-start;"><div class="stack" style="gap: 20px;">{rows_block}{author_block}</div><div class="stack" style="gap: 20px;">{dm_block}{card_block}</div></div>'
            '</div>\n' + tail(960, 1000))
    return body


# ---------------------------------------------------------------- write

OUT = {
    'Main.dc.html': main_inbox(),
    'Workstreams.dc.html': workstreams(),
    'Repaired.dc.html': repaired(),
    'InboxOnly.dc.html': inbox_only(),
    'Identity.dc.html': identity(),
}
for name, html in OUT.items():
    (HERE / name).write_text(html)

canvas = {
    "artboards": [
        {"file": "Main.dc.html", "x": 0, "y": 0, "w": 1440, "h": 900, "title": "A · Inbox + fleet"},
        {"file": "Workstreams.dc.html", "x": 1560, "y": 0, "w": 1440, "h": 900, "title": "B · Workstream first"},
        {"file": "Repaired.dc.html", "x": 3120, "y": 0, "w": 1440, "h": 900, "title": "C · Classic chat, repaired"},
        {"file": "InboxOnly.dc.html", "x": 0, "y": 1300, "w": 1440, "h": 900, "title": "D · Inbox only"},
        {"file": "Identity.dc.html", "x": 1560, "y": 1300, "w": 960, "h": 1000, "title": "Shared · who is this"},
    ],
    "annotations": [
        {"id": "a-inbox", "x": 0, "y": 960, "w": 700, "text": "A · Inbox + fleet.\n\nOpens on what needs you: @matt mentions and DM turns to you, then @here asks nobody claimed, then one line for everything else. Click a card, read it in the right column, reply from there. The sidebar is one tree: each repo room heads the workstreams inside it, DMs get a second line.\n\nFor: you stop reading 155 messages to find the two that matter.\nAgainst: 'unanswered' is inferred from claims and replies, so a question answered in a room post can linger until you mark it read."},
        {"id": "b-work", "x": 1560, "y": 960, "w": 700, "text": "B · Workstream first.\n\nThe unit is the pane, not the name. Pick jay in the tree and the page is jay's feed: everything jay said and was asked, across #boxscore and its DM, with the room or pair tagged on each message. The right column says what jay is, where, since when, and who jay talks to.\n\nFor: 'who is this' is answered by the page title, and a DM is just two workstreams' feeds overlapping.\nAgainst: the landing view is still a transcript, and a room debate between four agents is split across four feeds (the room stays one click up)."},
        {"id": "c-repair", "x": 3120, "y": 960, "w": 700, "text": "C · Classic chat, repaired.\n\nSame rooms, DMs, transcript and roster. Four repairs: the task line on every author, roster row and DM entry; long messages fold to their first paragraph with 'N more lines'; @here asks carry an unclaimed chip; offline rows show their repo.\n\nFor: smallest change, nothing moves.\nAgainst: #rt is still a wall of 155, and the roster still leads with status, so eight rt sessions still sit in one pile."},
        {"id": "d-only", "x": 0, "y": 2260, "w": 700, "text": "D · Inbox only.\n\nA without the sidebar. The fleet is a strip under the page bar (repo, then its live handles, then how many are off); rooms are reachable only from the 'everything else' chips. Everything else is A.\n\nFor: the least to maintain, and the page can only ever show you what matters.\nAgainst: no standing view of a room; the record is one hop away every time, and the strip has no room for task lines (they move to the hover)."},
        {"id": "decisions", "x": 1560, "y": 2360, "w": 900, "text": "Settled before drawing (2026-09-02).\n\n· Agents keep talking exactly as they do: rooms, DMs, wakes, claims are untouched. Every direction here is Matt's lens only.\n· The task line is a live join in the viewer: presence row → herdr pane by session id → the pane title Claude Code sets. No rt change. Fallback when the title is the handle or the pane is gone: branch (when not main), else the worktree folder; offline rows show sign-out age only.\n· rt pins a handle to its herdr pane, so a re-sign-in keeps the name (the one rt change).\n\nMatched to the app, not invented: the shared CSS block is design/build.py's (JetBrains Mono 13.5, IBM Plex Sans 16 prose, 6px radii, 68/64/64 chrome, 244 sidebar, 300 roster). New pieces: the sprite stands in for the invadrs avatar the app draws inside the hue chip; cards and the fleet strip reuse chip, badge and member rules.\n\nThe fleet, rooms, branches and pane ids are today's real ones; the messages are illustrative."},
    ],
    "launch": {"view": "canvas"},
}
(HERE / 'canvas.json').write_text(json.dumps(canvas, indent=2, ensure_ascii=False))
print(f"built {len(OUT)} artboards + canvas.json")
