# mattstack window: a native shell for deck apps

Date: 2026-09-15
Status: approved design, pre-plan
Mockup: `docs/design/mattstack-window/mattstack-window.pen` (render: `docs/design/mattstack-window/renders/window-dark.png`)

## What this is

One native macOS window that hosts every deck-served mattstack app (board,
boxscore, chat, console, gitq) behind a thin top tab bar, so the whole
estate lives in a single window that stays open all day. The window is a thin
shell: navigation chrome outside the apps, WKWebViews inside, and no logic
that would ever need updating when apps change.

The window lives inside the existing **mattstack.app** (rt-tray, in the
repo-tools repo). It is not a new app and not Tauri: the bundle already owns
the `mattstack://` URL scheme, ships Sparkle updates, is signed, and runs the
daemon estate. Tauri on macOS wraps the same WKWebView this uses directly.

Push notifications stay with rt; the shell does nothing there.

## Repos touched

- **repo-tools / rt-tray** (Swift, AppKit + SwiftUI): the window, tab bar,
  webviews, URL scheme routes, hotkey, tray menu item, handoff receiver
  (a TrayServer route).
- **mattstack-apps / packages/server + apps/board**: the navigation handoff
  helper (section 7), auto-wired in `createApp` and called manually by
  board's hand-rolled server.
- **apps/deck: untouched.** Deck is not in the local request path (portless
  proxies `<app>.mattstack` straight to each app's port; deck's gateway
  only sees tunnel traffic), and the handoff needs nothing from it.

## 1. Shell

A single titlebar-less `NSWindow` with the traffic lights inline in a thin
top tab bar; content is full-bleed below the bar with no other chrome. One
window only. Frame persists across launches.

Splash: on the first window show per process, a full-window splash covers
the content: dark ground and the app icon's mark only (monospace "m" with
the layers glyph to its right, drawn from make-icon.swift's shapes and
per-flavor colors). The glyph's layers drop into place bottom-up with a
tight spring settling around one second, then hold one more second before
the splash fades out over the live content (content renders beneath
throughout; clicks pass through the moment the fade starts). Dismissal
happens at whichever is later: that minimum visible time, or the active
app's first navigation finishing (success or failure); a hard cap of 8
seconds keeps anything from holding it. Re-shows of the window skip the
splash. All timings live in one tunables block.

Activation policy: the app is `LSUIElement` today. While the window is open
it flips to `.regular` (Dock icon, Cmd-Tab entry); when the window closes it
returns to `.accessory`. Entry points: an "Open mattstack" tray menu item, a
global summon/toggle hotkey (default ctrl-opt-cmd-M, configurable), and URL
opens (sections 4 and 7).

## 2. Top tab bar

(Replaced the original left icon rail on 2026-09-15: rendering apps that
carry their own left rail, chat and console, inside a shell rail produced a
double rail. A top bar removes the duplication structurally. Mockup:
`docs/design/mattstack-window/renders/window-tabs-dark.png`.)

Populated from `GET https://deck.mattstack/api/apps` at window open: name,
displayName, url, icon per app, rendered in API order. New deck apps appear
with zero shell changes. Icons are the SVGs deck serves, loaded via
`NSImage` (fine on the macOS 13 floor); a failed icon falls back to a
monogram.

- Bar: 34pt tall, fill `#0f0f15`, 1px bottom border `#313853`. System
  traffic lights at their native position, then a 12pt gap, then the tabs.
- Tabs: uniform 110pt wide, full bar height, square corners, 1px `#313853`
  separators on every boundary including the first tab's leading edge.
  Icon 18pt (corner radius 5) + lowercase displayName at 12px, left-anchored
  with a 10pt inset and 6pt icon-label gap.
- Active tab: fill `#1c2136`, full-color icon, label `#e3e7f6`, and a 2pt
  accent (`#7aa2f7`) underline. Inactive: fill `#16161e`, icon fully
  desaturated (SwiftUI `.saturation(0)`) at 75% opacity, label `#7e86ad`.
- Cmd-1..Cmd-9 select by tab order; tooltips show displayName + shortcut;
  right-click on a tab: Reload. Cmd-R reloads the active app's webview.
- Deck mini at the bar's far right: a muted lowercase "deck" label, then an
  18pt deck glyph with a 7pt ok-green dot at its top-right corner (2pt ring
  in the bar color) while the deck daemon is reachable. Opens the deck
  board in the window; outside the Cmd-N ordering.
- In-shell dedupe: apps detect the shell via the ` mattstack-shell/` UA
  marker and hide their own "switch app" launcher (app-kit's launcher for
  chat/console/boxscore via a shared `isInsideMattstackShell()` helper;
  board's own switcher with the same check). The shell's tabs are the one
  app switcher. gitq stays out of scope.
- Cross-app links inside a webview (e.g. deck's app listings) switch to
  that app's tab instead of navigating the current webview. Main-frame
  navigations to external hosts stay in the webview (auth and SSO redirect
  chains depend on it); target=_blank to an external http(s) host opens
  the default browser, and non-http(s) popup URLs (about:blank, the OAuth
  window.open prelude) are simply declined.

## 3. Webviews

One `WKWebView` per app, created on first visit, kept warm for the window's
lifetime (all-warm v1; memory evaluated on the running app, with
idle-teardown documented below as the lever if it misbehaves). Switching
apps hides/shows views and never reloads. All views share the default
`WKWebsiteDataStore`, so cookies and logins behave like one browser profile.

Every webview sets `customUserAgent` with a ` mattstack-shell/<version>`
suffix. This is the marker deck's handoff keys on (section 7), so it is a
compatibility contract, not cosmetics.

Fallback lever (not v1): tear down webviews idle longer than a threshold and
recreate on return, keeping the active app and chat pinned warm.

## 4. URL scheme

`mattstack://open/<app>[/<path>][?<query>]` opens or raises the window,
selects `<app>`, and navigates its webview to the app's URL joined with
`<path>`. Unknown apps raise the window and log; unknown verbs log and drop.
The existing `mattstack://join/<code>` flow is untouched; both routes live in
the same kAEGetURL handler in `AppDelegate`.

The bundle also declares `https` in its URL types (this does not make it the
default browser). A delivered https URL whose host is `*.mattstack` is
treated as an open; any other host is forwarded to the default browser. This
makes the app a valid target for `open -a mattstack <url>` and any link
router, with no scheme in the link.

## 5. Resilience

- The last good app list is cached as a JSON file under `~/.mattstack/rt/`
  (the `panel-columns.json` precedent: app-local state, not a resolver
  setting), so the tabs render when deck is down; rows for unreachable
  apps still open and show the load error.
- A failed navigation shows a minimal native error state with a Retry button
  in the content area, not a blank webview.
- Window frame persists via `setFrameAutosaveName` (UserDefaults, app-local
  UI state precedent). The handoff toggle is a tray Settings checkbox in
  UserDefaults. The hotkey is fixed at ctrl-opt-cmd-M in v1;
  configurability is deferred (a resolver key needs an rt-client registry
  change + npm publish, not worth it yet).
- No update mechanism of its own; the shell rides rt-tray's existing Sparkle
  releases, and the dynamic tab bar means app changes never require one.

## 6. Testing

- rt-tray (the MattstackCoreChecks harness, `swift test --package-path
  rt-tray`): route parsing for `mattstack://open` and https opens (host
  match, path join, unknown app), app-list decode plus cache fallback,
  the `/window/open` TrayRoutes handler.
- packages/server (vitest, injectable tray-poster seam so tests stay
  vitest-safe): the handoff matrix per section 7 including fail-open;
  board's call site covered by its own suite.
- Webview behavior (warm switching, shared cookies) is verified manually;
  the shell is deliberately too thin to warrant UI automation.

## 7. Navigation handoff (app-server middleware)

Plain `https://<app>.mattstack/...` links clicked anywhere (Slack, terminal,
editors) open in the window automatically, with no default-browser changes
and no OS prompts.

Reality check that reshaped this section: deck is NOT in the local request
path. portless proxies `<app>.mattstack` straight to each app's own port;
deck's gateway sees only tunnel traffic. Putting the gateway into the local
path was rejected: it would make a dead deck daemon take down local access
to every app. Instead the handoff lives in the apps themselves, where
failing open is free.

A `shellHandoff` helper ships in `@mattstack/app-server` (same à-la-carte
shape as `canonicalHostRedirect`): `createApp` runs it as its first
middleware (covers chat, console, boxscore automatically), and board calls
it manually at the top of its hand-rolled fetch handler. When a request is
ALL of:

- method GET, top-level document navigation (`Sec-Fetch-Dest: document`,
  falling back to `Accept: text/html` when the header is absent),
- host (from `x-forwarded-host`, falling back to `host`; portless rewrites
  `Host`) ending in `.mattstack`,
- user agent lacking the ` mattstack-shell/` marker,
- no `mattstack_browser=1` cookie, no `?browser=1` param,

the helper POSTs `{url}` to the tray's unix socket
(`~/.mattstack/rt/tray.sock`, `POST /window/open`). If the tray answers 200
`{"handled":true}` within 300ms, the app serves a tiny stub page ("opened
in mattstack", with a "continue in browser" link that sets the cookie and
reloads). Any other outcome (socket absent, timeout, non-200,
`handled:false`) serves the app normally: fail open by construction.

- Assets, XHR, and websockets never match the document check and pass
  through untouched.
- The on/off switch lives in the tray (Settings checkbox, default on): when
  off, the tray answers `handled:false` and browsers behave as today.
  Toggling needs no app restarts and no deck involvement.
- `.mattstack` resolves only locally and the tray socket is per-machine, so
  `*.m4tthew.dev` visitors and phones are structurally unaffected.
- The `mattstack://` redirect approach was rejected: it prompts in Chrome
  and strands a dead tab. Local IPC does neither.
- gitq does not use app-server and is out of scope (gitq web may never
  ship); its links keep opening in the browser.

## Decisions taken during brainstorming

- Reuse mattstack.app over a new Tauri app (bundle, scheme, Sparkle already
  exist; same engine).
- Rail is dynamic from deck's API; no hardcoded app list anywhere.
- All visited webviews stay warm in v1; measure before optimizing.
- Dock presence only while the window is open, plus a global hotkey.
- App-server handoff supersedes link-router apps (Velja/Finicky) and the
  "mattstack.app as default browser" idea; both rejected as setup-heavy or
  invasive. Deck-gateway interception was rejected for the availability
  regression (section 7).

## Non-goals

- Notifications (rt owns them), multi-window or tabs, offline caching of app
  UIs, universal links (impossible for a local TLD), acting as default
  browser, any in-shell rendering of app content beyond WKWebView, gitq
  link interception (no app-server; gitq web may never ship), deck changes
  of any kind.
