# mattstack window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One native window in mattstack.app hosting every deck app behind an icon rail, with `mattstack://open` deep links and automatic capture of plain `https://<app>.mattstack` browser navigations.

**Architecture:** rt-tray (repo-tools) grows a `MattstackWindowController` with one warm WKWebView per app, a rail fed by deck's `/api/apps`, a `/window/open` TrayServer route, and URL-scheme routing; `@mattstack/app-server` (mattstack-apps) grows a `shellHandoff` helper that createApp wires automatically and board calls manually. Deck is untouched.

**Tech Stack:** Swift (AppKit + SwiftUI + WebKit + Carbon hotkey), the MattstackCoreChecks harness; TypeScript (Hono, Bun unix-socket fetch), vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-mattstack-window-design.md` (this repo). Read it first; the mockup render is `docs/design/mattstack-window/renders/window-dark.png`.

## Global Constraints

- **Cross-repo:** Tasks 1-7 run in a **repo-tools worktree** (rt-managed: enter via EnterWorktree name-mode, never `git worktree add` by hand; the main checkout at `~/Documents/GitHub/repo-tools` is read-only reference). Tasks 8-10 run in a **mattstack-apps worktree**.
- **Wire contracts (both repos depend on these exact strings):**
  - UA marker: webviews set `WKWebViewConfiguration.applicationNameForUserAgent = "mattstack-shell/<CFBundleShortVersionString>"`; the middleware matches the substring ` mattstack-shell/`.
  - Tray endpoint: `POST /window/open` over the unix socket `~/.mattstack/rt/tray.sock` (env override `RT_APP_SOCKET`), JSON body `{"url": "https://<app>.mattstack/<path>?<q>"}`, reply `200 {"handled":true|false}`, client timeout 300ms.
  - Escape hatches: cookie `mattstack_browser=1`, query param `?browser=1`.
- **repo-tools rules:** never rebuild, re-sign, or reinstall `/Applications/mattstack.app` or the in-tree `rt-tray/mattstack-dev.app` (it invalidates Login Items + TCC). Verification builds go to a scratch dir or use `swift build`. Every HOME-derived path in app code goes through `AppHome.current`, never `NSHomeDirectory()`. Log via `TrayLog`, never `NSLog`/`print`.
- **repo-tools tests:** pure logic lives in `Sources-core/` (MattstackCore, no AppKit). Checks are the hand-rolled harness in `Tests/MattstackCoreChecks/` (`Check` structs), and every new check file MUST be appended to `let allChecks` in `Tests/MattstackCoreChecks/AllChecks.swift` (explicit registry, no reflection). Check files must not contain the strings `launchctl`, `pkill`, `tccutil`, `osascript`, `/usr/bin/open`, or `SystemCommandRunner(` (SourceGuardChecks enforces). Run: `swift test --package-path rt-tray`, or filtered: `cd rt-tray && swift run mattstack-checks <substring>`.
- **mattstack-apps rules:** `packages/server` subpath exports (everything except `.`) must stay vitest-safe: never import `hono/bun`. Tests sit beside source as `*.test.ts`. Run: `cd packages/server && bunx vitest run src/<file>.test.ts`; board: `bun run board:typecheck && bun run board:test` from repo root (`bun run tui-kit:build` first if not yet built in the tree).
- macOS floor is 13.0. Commit after every task; short imperative commit messages.

---

### Task 1: OpenLink parsing (MattstackCore)

**Files:**
- Create: `rt-tray/Sources-core/Launch/OpenLink.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/OpenLinkChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift` (append `openLinkChecks`)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `OpenRequest { app: String, pathAndQuery: String }`, `OpenLink.request(from:) -> OpenRequest?` (mattstack:// form), `OpenLink.request(fromHTTPS:) -> OpenRequest?`, `WindowNavigation.destination(for:in:) -> URL?`, and `DiscoveryApp` (Codable struct, also used by Task 2). Tasks 3-6 rely on these exact names.

Follow the `JoinLink` pattern (`Sources-core/Launch/LaunchGuard.swift:17-24`): static parsers, no state.

- [ ] **Step 1: Write the failing checks**

```swift
// rt-tray/Tests/MattstackCoreChecks/OpenLinkChecks.swift
import Foundation
@testable import MattstackCore

let openLinkChecks: [Check] = [
    Check("mattstack://open/<app>/<path>?q parses") { c in
        let r = OpenLink.request(from: URL(string: "mattstack://open/board/mr/123?tab=ci")!)
        try c.requireEqual(r, OpenRequest(app: "board", pathAndQuery: "/mr/123?tab=ci"))
    },
    Check("mattstack://open/<app> parses with empty path") { c in
        let r = OpenLink.request(from: URL(string: "mattstack://open/chat")!)
        try c.requireEqual(r, OpenRequest(app: "chat", pathAndQuery: ""))
    },
    Check("mattstack://join is not an open link") { c in
        c.expect(OpenLink.request(from: URL(string: "mattstack://join/ABC")!) == nil)
    },
    Check("mattstack://open with no app is rejected") { c in
        c.expect(OpenLink.request(from: URL(string: "mattstack://open")!) == nil)
    },
    Check("https://<app>.mattstack/<path> parses") { c in
        let r = OpenLink.request(fromHTTPS: URL(string: "https://console.mattstack/runs/9?x=1")!)
        try c.requireEqual(r, OpenRequest(app: "console", pathAndQuery: "/runs/9?x=1"))
    },
    Check("https root path parses to empty pathAndQuery") { c in
        let r = OpenLink.request(fromHTTPS: URL(string: "https://chat.mattstack/")!)
        try c.requireEqual(r, OpenRequest(app: "chat", pathAndQuery: ""))
    },
    Check("non-mattstack https host is rejected") { c in
        c.expect(OpenLink.request(fromHTTPS: URL(string: "https://example.com/a")!) == nil)
        c.expect(OpenLink.request(fromHTTPS: URL(string: "https://a.b.mattstack/")!) == nil)
    },
    Check("destination joins app url and path") { c in
        let apps = [DiscoveryApp(name: "board", displayName: "Board", description: nil,
                                 url: "https://board.mattstack", icon: nil)]
        let dest = WindowNavigation.destination(for: OpenRequest(app: "board", pathAndQuery: "/mr/1"), in: apps)
        try c.requireEqual(dest, URL(string: "https://board.mattstack/mr/1"))
        c.expect(WindowNavigation.destination(for: OpenRequest(app: "nope", pathAndQuery: ""), in: apps) == nil)
    },
]
```

- [ ] **Step 2: Register the check file and run to verify failure**

Append to `let allChecks` in `Tests/MattstackCoreChecks/AllChecks.swift`: `+ openLinkChecks`.
Run: `swift build --package-path rt-tray` — Expected: FAIL (OpenLink not defined).

- [ ] **Step 3: Implement**

```swift
// rt-tray/Sources-core/Launch/OpenLink.swift
import Foundation

public struct OpenRequest: Equatable, Sendable {
    public let app: String
    /// "" or a string starting with "/", query included.
    public let pathAndQuery: String
    public init(app: String, pathAndQuery: String) {
        self.app = app
        self.pathAndQuery = pathAndQuery
    }
}

public struct DiscoveryApp: Codable, Equatable, Sendable {
    public let name: String
    public let displayName: String
    public let description: String?
    public let url: String
    public let icon: String?
    public init(name: String, displayName: String, description: String?, url: String, icon: String?) {
        self.name = name; self.displayName = displayName
        self.description = description; self.url = url; self.icon = icon
    }
}

public enum OpenLink {
    /// mattstack://open/<app>[/<path...>][?query]
    public static func request(from url: URL) -> OpenRequest? {
        guard url.scheme?.lowercased() == "mattstack", url.host?.lowercased() == "open" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard let app = parts.first, !app.isEmpty else { return nil }
        var rest = parts.count > 1 ? "/" + parts.dropFirst().joined(separator: "/") : ""
        if let q = url.query, !q.isEmpty { rest += "?" + q }
        return OpenRequest(app: app.lowercased(), pathAndQuery: rest)
    }

    /// https://<app>.mattstack[/<path...>][?query] — single label only.
    public static func request(fromHTTPS url: URL) -> OpenRequest? {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        guard let host = url.host?.lowercased(), host.hasSuffix(".mattstack") else { return nil }
        let app = String(host.dropLast(".mattstack".count))
        guard !app.isEmpty, !app.contains(".") else { return nil }
        var rest = url.path == "/" || url.path.isEmpty ? "" : url.path
        if let q = url.query, !q.isEmpty { rest += "?" + q }
        return OpenRequest(app: app, pathAndQuery: rest)
    }
}

public enum WindowNavigation {
    public static func destination(for request: OpenRequest, in apps: [DiscoveryApp]) -> URL? {
        guard let app = apps.first(where: { $0.name == request.app }) else { return nil }
        return URL(string: app.url + request.pathAndQuery)
    }
}
```

- [ ] **Step 4: Run checks to verify pass**

Run: `swift test --package-path rt-tray` (or `cd rt-tray && swift run mattstack-checks OpenLink`)
Expected: PASS, all OpenLink checks green, nothing else broken.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Launch/OpenLink.swift rt-tray/Tests/MattstackCoreChecks/OpenLinkChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift
git commit -m "rt-tray: add OpenLink parsing for window deep links"
```

---

### Task 2: AppCatalog fetch + cache (MattstackCore)

**Files:**
- Create: `rt-tray/Sources-core/Window/AppCatalog.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/AppCatalogChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift` (append `appCatalogChecks`)

**Interfaces:**
- Consumes: `DiscoveryApp` from Task 1.
- Produces: `AppListFetching` protocol (`func fetchAppsJSON() async throws -> Data`), `AppCatalog(fetcher:cachePath:)` with `func load() async -> [DiscoveryApp]` and `static func decode(_ data: Data) throws -> [DiscoveryApp]`. Task 5 constructs it with a URLSession-backed fetcher and `cachePath: AppHome.current + "/.mattstack/rt/window-apps-cache.json"`.

The deck payload shape (verified live): `{"apps":[{"name":"board","displayName":"Board","description":"...","url":"https://board.mattstack","icon":"https://deck.mattstack/api/apps/board/icon"}, ...]}`.

- [ ] **Step 1: Write the failing checks**

```swift
// rt-tray/Tests/MattstackCoreChecks/AppCatalogChecks.swift
import Foundation
@testable import MattstackCore

private final class FakeFetcher: AppListFetching, @unchecked Sendable {
    var result: Result<Data, Error> = .failure(URLError(.notConnectedToInternet))
    func fetchAppsJSON() async throws -> Data { try result.get() }
}

private let sampleJSON = Data(#"""
{"apps":[{"name":"board","displayName":"Board","description":"MRs","url":"https://board.mattstack","icon":"https://deck.mattstack/api/apps/board/icon"},{"name":"chat","displayName":"Chat","description":null,"url":"https://chat.mattstack","icon":null}]}
"""#.utf8)

private func tmpCachePath() -> String {
    NSTemporaryDirectory() + "window-apps-cache-\(UUID().uuidString).json"
}

let appCatalogChecks: [Check] = [
    Check("decode parses the deck payload") { c in
        let apps = try AppCatalog.decode(sampleJSON)
        try c.requireEqual(apps.map(\.name), ["board", "chat"])
        try c.requireEqual(apps[0].url, "https://board.mattstack")
    },
    Check("load fetches, returns apps, and writes the cache") { c in
        let f = FakeFetcher(); f.result = .success(sampleJSON)
        let path = tmpCachePath()
        let apps = await AppCatalog(fetcher: f, cachePath: path).load()
        try c.requireEqual(apps.count, 2)
        c.expect(FileManager.default.fileExists(atPath: path))
    },
    Check("load falls back to the cache when fetch fails") { c in
        let path = tmpCachePath()
        try sampleJSON.write(to: URL(fileURLWithPath: path))
        let apps = await AppCatalog(fetcher: FakeFetcher(), cachePath: path).load()
        try c.requireEqual(apps.map(\.name), ["board", "chat"])
    },
    Check("load returns empty when fetch and cache both fail") { c in
        let apps = await AppCatalog(fetcher: FakeFetcher(), cachePath: tmpCachePath()).load()
        try c.requireEqual(apps, [])
    },
]
```

- [ ] **Step 2: Register and run to verify failure**

Append `+ appCatalogChecks` in `AllChecks.swift`. Run: `swift build --package-path rt-tray` — Expected: FAIL (AppCatalog not defined).

- [ ] **Step 3: Implement**

```swift
// rt-tray/Sources-core/Window/AppCatalog.swift
import Foundation

public protocol AppListFetching: Sendable {
    func fetchAppsJSON() async throws -> Data
}

/// Fetch-through cache for deck's /api/apps: network first, last good copy
/// on disk second, empty last. The cache is app-local state, not a setting.
public struct AppCatalog: Sendable {
    private struct Payload: Codable { let apps: [DiscoveryApp] }
    private let fetcher: AppListFetching
    private let cachePath: String

    public init(fetcher: AppListFetching, cachePath: String) {
        self.fetcher = fetcher
        self.cachePath = cachePath
    }

    public static func decode(_ data: Data) throws -> [DiscoveryApp] {
        try JSONDecoder().decode(Payload.self, from: data).apps
    }

    public func load() async -> [DiscoveryApp] {
        if let data = try? await fetcher.fetchAppsJSON(), let apps = try? Self.decode(data) {
            try? data.write(to: URL(fileURLWithPath: cachePath))
            return apps
        }
        guard let cached = FileManager.default.contents(atPath: cachePath),
              let apps = try? Self.decode(cached) else { return [] }
        return apps
    }
}
```

- [ ] **Step 4: Run checks to verify pass**

Run: `cd rt-tray && swift run mattstack-checks AppCatalog` then the full `swift test --package-path rt-tray`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Window/AppCatalog.swift rt-tray/Tests/MattstackCoreChecks/AppCatalogChecks.swift rt-tray/Tests/MattstackCoreChecks/AllChecks.swift
git commit -m "rt-tray: add AppCatalog with disk-cache fallback"
```

---

### Task 3: TrayRoutes POST /window/open

**Files:**
- Modify: `rt-tray/Sources-core/Routes/Providers.swift` (add `WindowOpening`)
- Modify: `rt-tray/Sources-core/Routes/TrayRoutes.swift` (path + case + stored provider)
- Modify: `rt-tray/Tests/MattstackCoreChecks/TrayRoutesChecks.swift` (new checks; update `makeRoutes()` factory and every `TrayRoutes(...)` construction for the new parameter)

**Interfaces:**
- Consumes: `RouteResponse`, the `field(_:in:)` body helper, the existing `TrayRoutes` init.
- Produces: `public protocol WindowOpening: Sendable { func open(url: String) async -> Bool }` and the route: `POST /window/open` body `{"url": "..."}` → `200 {"handled":true|false}`; missing `url` → the existing `bad(...)` shape. Task 6 injects the real implementation; Task 8's middleware calls this endpoint.

- [ ] **Step 1: Write the failing checks**

Add to `TrayRoutesChecks.swift`, following the file's existing fake + factory style (add a `FakeWindowOpener` and thread it through `makeRoutes()`):

```swift
final class FakeWindowOpener: WindowOpening, @unchecked Sendable {
    var handled = true
    var seen: [String] = []
    func open(url: String) async -> Bool { seen.append(url); return handled }
}

// New checks appended to trayRoutesChecks:
Check("POST /window/open forwards the url and reports handled") { c in
    let (r, _, _, _, _, _, window) = makeRoutes()
    window.handled = true
    let body = Data(#"{"url":"https://board.mattstack/mr/1"}"#.utf8)
    let res = await r.handle(method: "POST", path: "/window/open", body: body)
    try c.requireEqual(res?.status, 200)
    try c.requireEqual(res?.body, #"{"handled":true}"#)
    try c.requireEqual(window.seen, ["https://board.mattstack/mr/1"])
},
Check("POST /window/open without url is a 400") { c in
    let (r, _, _, _, _, _, _) = makeRoutes()
    let res = await r.handle(method: "POST", path: "/window/open", body: Data("{}".utf8))
    try c.requireEqual(res?.status, 400)
},
Check("GET /window/open is method-not-allowed") { c in
    let (r, _, _, _, _, _, _) = makeRoutes()
    let res = await r.handle(method: "GET", path: "/window/open", body: nil)
    try c.requireEqual(res?.status, 405)
},
```

(Adjust the tuple arity to however many fakes `makeRoutes()` currently returns; add the window fake at the end.)

- [ ] **Step 2: Run to verify failure**

Run: `swift build --package-path rt-tray` — Expected: FAIL (`WindowOpening` not defined / init arity).

- [ ] **Step 3: Implement**

In `Providers.swift`:

```swift
public protocol WindowOpening: Sendable {
    /// True when the shell window took the navigation; false lets the
    /// caller (an app's handoff middleware) serve the page normally.
    func open(url: String) async -> Bool
}
```

In `TrayRoutes.swift`: add `"/window/open"` to `paths`, store `private let window: WindowOpening` via a new init parameter, and add the case:

```swift
case ("POST", "/window/open"):
    guard let url = field("url", in: body) else { return bad("url is required") }
    return RouteResponse(status: 200, body: "{\"handled\":\(await window.open(url: url))}")
```

Update the construction at `Sources/AppDelegate.swift:364-365` with a temporary stub so the app still compiles (Task 6 replaces it):

```swift
struct WindowOpeningUnavailable: WindowOpening {
    func open(url: String) async -> Bool { false }
}
```

- [ ] **Step 4: Run checks to verify pass**

Run: `swift test --package-path rt-tray`. Expected: PASS including the three new checks.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core/Routes rt-tray/Tests/MattstackCoreChecks/TrayRoutesChecks.swift rt-tray/Sources/AppDelegate.swift
git commit -m "rt-tray: add POST /window/open tray route behind WindowOpening"
```

---

### Task 4: WebViewStore (warm per-app webviews)

**Files:**
- Create: `rt-tray/Sources/Window/WebViewStore.swift`
- Modify: `rt-tray/Package.swift` (append `.linkedFramework("WebKit")` to the executable target's `linkerSettings`; SwiftPM does not auto-link from `import WebKit`, the xcodegen path does)

**Interfaces:**
- Consumes: `DiscoveryApp` (Task 1).
- Produces: `@MainActor final class WebViewStore` with `func view(for app: DiscoveryApp) -> WKWebView` (creates on first ask, returns the same instance after), `func existingView(for name: String) -> WKWebView?`, `func reload(_ name: String)`. Task 5 renders these views and reads `shellUserAgentSuffix`.

No harness checks for this task (AppKit/WebKit): correctness is compile + Task 5's manual verification. Keep it dumb.

- [ ] **Step 1: Implement**

```swift
// rt-tray/Sources/Window/WebViewStore.swift
import WebKit

/// One warm WKWebView per visited app, alive for the window's lifetime
/// (spec section 3). All views share the default website data store so the
/// estate behaves like one browser profile.
@MainActor
final class WebViewStore {
    /// Appended to the default UA by WebKit. The app-server handoff
    /// middleware matches " mattstack-shell/" — compatibility contract.
    static var shellUserAgentSuffix: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        return "mattstack-shell/\(version)"
    }

    private var views: [String: WKWebView] = [:]

    func view(for app: DiscoveryApp) -> WKWebView {
        if let existing = views[app.name] { return existing }
        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = Self.shellUserAgentSuffix
        config.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: config)
        view.allowsBackForwardNavigationGestures = true
        if let url = URL(string: app.url) { view.load(URLRequest(url: url)) }
        views[app.name] = view
        return view
    }

    func existingView(for name: String) -> WKWebView? { views[name] }

    func reload(_ name: String) { views[name]?.reload() }
}
```

- [ ] **Step 2: Build**

Run: `swift build --package-path rt-tray` — Expected: compiles (if `WebKit` link errors appear, the `Package.swift` linkerSettings change is missing).

- [ ] **Step 3: Commit**

```bash
git add rt-tray/Sources/Window/WebViewStore.swift rt-tray/Package.swift
git commit -m "rt-tray: add WebViewStore with mattstack-shell UA marker"
```

---

### Task 5: The window: controller, rail, content

**Files:**
- Create: `rt-tray/Sources/Window/MattstackWindowController.swift`
- Create: `rt-tray/Sources/Window/MattstackWindowView.swift` (rail + content SwiftUI)
- Create: `rt-tray/Sources/Window/WindowModel.swift`

**Interfaces:**
- Consumes: `WebViewStore` (Task 4), `AppCatalog`/`DiscoveryApp`/`OpenRequest`/`WindowNavigation` (Tasks 1-2), the `SettingsWindowController` window pattern, `AppHome.current`.
- Produces: `MattstackWindowController(model:)` with `func show()`, and `@MainActor final class WindowModel: ObservableObject` with `func open(_ request: OpenRequest) -> Bool`, `func select(_ name: String)`, `func toggleVisibility()`. Task 6 calls `show()`/`open(_:)`; Task 7 calls `toggleVisibility()`.

Design contract (from the spec + mockup, `renders/window-dark.png`):
- Titlebar-less: `styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]`, `titlebarAppearsTransparent = true`, `titleVisibility = .hidden` — traffic lights float over the rail; the rail's top padding (~40pt) clears them.
- Rail: 68pt wide, dark fill, app tiles 38pt (rounded 9), active app gets a 3pt accent bar and full opacity, inactive tiles at 68% opacity, tooltips "DisplayName ⌘n" via `.help(...)`, `⌘1...⌘9` via `.keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)`, `⌘R` reloads the active view. Right-click tile → Reload (`.contextMenu`).
- Deck tile pinned at the rail bottom (utility slot, outside ⌘n): opens `https://deck.mattstack` as pseudo-app `deck` (append a `DiscoveryApp(name: "deck", displayName: "Deck", description: nil, url: "https://deck.mattstack", icon: nil)` handled separately from the API list); green 10pt badge when the last catalog fetch succeeded.
- Icons: fetch each `icon` URL with `URLSession.shared.data(from:)`, `NSImage(data:)` (SVG decodes natively on macOS 13); fallback = rounded rect with the first letter of `displayName`.
- Content: an `NSViewRepresentable` that mounts `store.view(for: activeApp)`; switching swaps the mounted view, never reloads. Views for visited apps stay in the store (all-warm v1).
- Error state: a `WKNavigationDelegate` on each view reports `didFailProvisionalNavigation` into `WindowModel.loadFailures[name]`; the content area overlays "Can't reach <displayName>" + Retry button (calls `store.reload(name)`, clears the failure).
- Frame: `window.setFrameAutosaveName("mattstack-window")`.
- Activation policy: in `show()` call `NSApp.setActivationPolicy(.regular)` before `makeKeyAndOrderFront`; in `windowWillClose` restore `NSApp.setActivationPolicy(.accessory)`.
- `WindowModel.open(_ request:)`: ensure catalog loaded (`await AppCatalog(...).load()` on first show, stored in `apps`), resolve via `WindowNavigation.destination(for:in:)`; unknown app → return false; known → select the app, and when `pathAndQuery` is non-empty, `store.view(for: app).load(URLRequest(url: dest))`; return true.
- `WindowModel.toggleVisibility()`: window key + visible → `close()`; otherwise `show()`.
- Catalog wiring: `AppCatalog(fetcher: URLSessionAppListFetcher(), cachePath: AppHome.current + "/.mattstack/rt/window-apps-cache.json")` where `URLSessionAppListFetcher` does `try await URLSession.shared.data(from: URL(string: "https://deck.mattstack/api/apps")!)` and returns the data.

- [ ] **Step 1: Implement the three files per the contract above**

Follow `SettingsWindowController.swift` exactly for the controller skeleton (`NSWindowController, NSWindowDelegate`, `NSHostingController` content, `isReleasedWhenClosed = false`).

- [ ] **Step 2: Build**

Run: `swift build --package-path rt-tray` — Expected: compiles.

- [ ] **Step 3: Manual smoke (scratch build, no bundle install)**

The window is not yet reachable from the UI (Task 6 wires entry points). Smoke = compile plus a temporary `#if DEBUG` show call if desired, removed before commit. Full manual verification happens in Task 10.

- [ ] **Step 4: Commit**

```bash
git add rt-tray/Sources/Window
git commit -m "rt-tray: add mattstack window with rail and warm webviews"
```

---

### Task 6: Entry points: URL scheme, https, gear menu, tray route wiring

**Files:**
- Modify: `rt-tray/Sources/AppDelegate.swift` (handleGetURL at ~:429, pending queue at ~:58, buildServices at ~:345-395, observers at ~:101-131, new ivar + `@objc func showMattstackWindow()`)
- Modify: `rt-tray/Sources/TrayState.swift:59-68` (add `Notification.Name.showMattstackWindow`)
- Modify: `rt-tray/Sources/ProcessPanelView.swift:72-122` (gear menu item)
- Modify: `rt-tray/Sources/AccessibilityIDs.swift` (add `menuGearMattstackWindow`)
- Modify: `rt-tray/Info.plist` (append https CFBundleURLTypes entry at index 1 — `check-bundle.sh:122` asserts index 0 is `mattstack`, so append, never prepend)
- Modify: `rt-tray/project.yml` (mirror the CFBundleURLTypes addition in `targetTemplates.MattstackApp.info.properties`)

**Interfaces:**
- Consumes: `OpenLink`, `MattstackWindowController`/`WindowModel` (Task 5), `WindowOpening` (Task 3), `JoinLink`.
- Produces: the live `mattstack://open` route, https delivery handling, the gear menu entry, and the real `WindowOpening` bridge replacing Task 3's stub.

- [ ] **Step 1: Extend handleGetURL**

Replace the body's join-only routing (keep join first, exact existing behavior):

```swift
@objc private func handleGetURL(_ event: NSAppleEventDescriptor, with reply: NSAppleEventDescriptor) {
    guard let s = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
          let url = URL(string: s) else { return }
    if let code = JoinLink.code(from: url) {
        // ... existing join path, unchanged ...
        return
    }
    if let request = OpenLink.request(from: url) ?? OpenLink.request(fromHTTPS: url) {
        Task { @MainActor in
            guard let windowModel else { pendingOpen = request; return }
            _ = windowModel.open(request)
        }
        return
    }
    if url.scheme == "https" || url.scheme == "http" {
        // Delivered an https URL we don't own (a router misfire): punt to
        // the default browser rather than swallowing it.
        NSWorkspace.shared.open(url)
        return
    }
    TrayLog.warn("ignored URL", ["scheme": url.scheme ?? "", "host": url.host ?? ""])
}
```

Add `private var pendingOpen: OpenRequest?` next to `pendingJoinCode` (~:58) and drain it in `buildServices()` exactly where `pendingJoinCode` drains (~:369).

- [ ] **Step 2: Wire the window into buildServices + menus**

- Ivar: `private var windowModel: WindowModel?` + `private var mattstackWindow: MattstackWindowController?`; construct in `buildServices()`.
- Replace Task 3's `WindowOpeningUnavailable` stub in the `TrayRoutes(...)` construction with a bridge:

```swift
final class WindowOpenBridge: WindowOpening, @unchecked Sendable {
    weak var appDelegate: AppDelegate?
    func open(url: String) async -> Bool {
        let defaults = UserDefaults.standard
        let enabled = defaults.object(forKey: "MSShellHandoff") == nil || defaults.bool(forKey: "MSShellHandoff")
        guard enabled, let u = URL(string: url), let request = OpenLink.request(fromHTTPS: u) else { return false }
        return await MainActor.run { [weak appDelegate] in
            guard let model = appDelegate?.windowModel else { return false }
            return model.open(request)
        }
    }
}
```

- `Notification.Name.showMattstackWindow` in `TrayState.swift`; observer + `@objc func showMattstackWindow()` in `startNormalOperation()` (the `.showKeyboardConflict` observer at ~:101-131 is the template); gear menu item in `makeGearMenu()`:

```swift
menu.addItem(ActionMenuItem("Open mattstack", axid: AXID.menuGearMattstackWindow) {
    NotificationCenter.default.post(name: .showMattstackWindow, object: nil)
})
```

- [ ] **Step 3: Info.plist + project.yml https entry**

Append to the `CFBundleURLTypes` array in `rt-tray/Info.plist` (index 1):

```xml
<dict>
    <key>CFBundleURLName</key>
    <string>@@BUNDLE_ID@@.web</string>
    <key>CFBundleURLSchemes</key>
    <array>
        <string>https</string>
        <string>http</string>
    </array>
</dict>
```

Mirror in `project.yml` under `targetTemplates.MattstackApp.info.properties.CFBundleURLTypes` (second entry, `CFBundleURLName: "$(PRODUCT_BUNDLE_IDENTIFIER).web"`). Note: this does NOT make the app default browser; it makes it a valid https target for `open -a` and router apps (spec section 4).

- [ ] **Step 4: Verify**

Run: `swift test --package-path rt-tray` — Expected: PASS (TrayRoutes checks still green with the bridge compiled).
Run: `bash rt-tray/check-bundle.sh --help >/dev/null 2>&1 || true` — plist assertions run in Task 10's scratch build.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources rt-tray/Info.plist rt-tray/project.yml
git commit -m "rt-tray: wire mattstack window entry points (scheme, https, gear menu, tray route)"
```

---

### Task 7: Global hotkey + handoff settings checkbox

**Files:**
- Create: `rt-tray/Sources/Window/HotkeyManager.swift`
- Modify: `rt-tray/Sources/AppDelegate.swift` (register in `startNormalOperation()`)
- Modify: `rt-tray/Sources/Settings/GeneralPane.swift` (checkbox)

**Interfaces:**
- Consumes: `WindowModel.toggleVisibility()` (Task 5); `UserDefaults` key `MSShellHandoff` (read by Task 6's bridge).
- Produces: ctrl-opt-cmd-M summon/toggle; a "Open .mattstack links in the mattstack window" checkbox.

Carbon `RegisterEventHotKey` needs no TCC grant (unlike event taps) — that's why it's the mechanism.

- [ ] **Step 1: Implement HotkeyManager**

```swift
// rt-tray/Sources/Window/HotkeyManager.swift
import Carbon.HIToolbox

/// Registers ctrl-opt-cmd-M via Carbon RegisterEventHotKey: no Accessibility
/// or Input Monitoring grant needed, works for an LSUIElement app.
final class HotkeyManager {
    private var hotKeyRef: EventHotKeyRef?
    private var handlerRef: EventHandlerRef?
    private let onPress: () -> Void

    init(onPress: @escaping () -> Void) {
        self.onPress = onPress
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
            guard let userData else { return noErr }
            Unmanaged<HotkeyManager>.fromOpaque(userData).takeUnretainedValue().onPress()
            return noErr
        }, 1, &eventType, selfPtr, &handlerRef)
        let hotKeyID = EventHotKeyID(signature: OSType(0x4D_53_54_4B), id: 1) // "MSTK"
        RegisterEventHotKey(UInt32(kVK_ANSI_M), UInt32(controlKey | optionKey | cmdKey),
                            hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    deinit {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let handlerRef { RemoveEventHandler(handlerRef) }
    }
}
```

In `AppDelegate.startNormalOperation()`: `hotkey = HotkeyManager { [weak self] in Task { @MainActor in self?.windowModel?.toggleVisibility() } }` with `private var hotkey: HotkeyManager?`.

- [ ] **Step 2: Settings checkbox**

In `GeneralPane.swift`, following the pane's existing toggle style:

```swift
Toggle("Open .mattstack links in the mattstack window",
       isOn: Binding(
           get: { UserDefaults.standard.object(forKey: "MSShellHandoff") == nil
                  || UserDefaults.standard.bool(forKey: "MSShellHandoff") },
           set: { UserDefaults.standard.set($0, forKey: "MSShellHandoff") }))
```

- [ ] **Step 3: Build + full checks**

Run: `swift test --package-path rt-tray` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add rt-tray/Sources/Window/HotkeyManager.swift rt-tray/Sources/AppDelegate.swift rt-tray/Sources/Settings/GeneralPane.swift
git commit -m "rt-tray: global hotkey and shell-handoff toggle"
```

---

### Task 8: shellHandoff helper (packages/server) — mattstack-apps worktree

**Files:**
- Create: `packages/server/src/shell-handoff.ts`
- Create: `packages/server/src/shell-handoff.test.ts`
- Modify: `packages/server/package.json` (exports: `"./shell-handoff": "./src/shell-handoff.ts"`)

**Interfaces:**
- Consumes: the tray contract from Global Constraints (`POST /window/open`, `{"url"}`, `{"handled"}`, 300ms, socket path).
- Produces: `shellHandoff(req: Request, deps?: ShellHandoffDeps): Promise<Response | null>` (null = serve normally), `SHELL_UA_MARKER`, `traySockPath()`. Task 9 wires it into `createApp` and board.

Must stay vitest-safe (no `hono/bun` import). The Bun-only `fetch({ unix })` lives behind the injectable `post` seam so vitest never executes it.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/server/src/shell-handoff.test.ts
import { describe, expect, it, vi } from 'vitest';
import { shellHandoff } from './shell-handoff';

const SOCK = '/dev/null'; // exists on every mac/linux box; existence gate passes
const docReq = (over: Record<string, string> = {}, url = 'https://chat.mattstack/room/9?x=1') =>
  new Request(url, {
    headers: {
      host: '127.0.0.1:11002',
      'x-forwarded-host': 'chat.mattstack',
      'sec-fetch-dest': 'document',
      'user-agent': 'Mozilla/5.0 Chrome/130',
      ...over,
    },
  });
const deps = (handled: boolean) => {
  const post = vi.fn(async () => handled);
  return { post, sockPath: SOCK };
};

describe('shellHandoff', () => {
  it('hands off a top-level document GET and serves the stub', async () => {
    const d = deps(true);
    const res = await shellHandoff(docReq(), d);
    expect(res?.status).toBe(200);
    expect(await res!.text()).toContain('opened in mattstack');
    expect(d.post).toHaveBeenCalledWith(SOCK, 'https://chat.mattstack/room/9?x=1', 300);
  });
  it('serves normally when the tray declines', async () => {
    expect(await shellHandoff(docReq(), deps(false))).toBeNull();
  });
  it('ignores the shell webview UA', async () => {
    const d = deps(true);
    expect(await shellHandoff(docReq({ 'user-agent': 'Mozilla/5.0 mattstack-shell/2.7.0' }), d)).toBeNull();
    expect(d.post).not.toHaveBeenCalled();
  });
  it('ignores non-document fetches (assets, XHR)', async () => {
    expect(await shellHandoff(docReq({ 'sec-fetch-dest': 'image' }), deps(true))).toBeNull();
  });
  it('falls back to Accept when Sec-Fetch-Dest is absent', async () => {
    const req = new Request('https://chat.mattstack/', {
      headers: { 'x-forwarded-host': 'chat.mattstack', accept: 'text/html,*/*', 'user-agent': 'x' },
    });
    expect((await shellHandoff(req, deps(true)))?.status).toBe(200);
  });
  it('ignores non-mattstack hosts (tunnel traffic)', async () => {
    expect(await shellHandoff(docReq({ 'x-forwarded-host': 'chat.m4tthew.dev' }), deps(true))).toBeNull();
  });
  it('honors the escape hatches', async () => {
    expect(await shellHandoff(docReq({}, 'https://chat.mattstack/?browser=1'), deps(true))).toBeNull();
    expect(await shellHandoff(docReq({ cookie: 'a=b; mattstack_browser=1' }), deps(true))).toBeNull();
  });
  it('ignores non-GET and upgrades', async () => {
    const post = new Request('https://chat.mattstack/', { method: 'POST' });
    expect(await shellHandoff(post, deps(true))).toBeNull();
    expect(await shellHandoff(docReq({ upgrade: 'websocket' }), deps(true))).toBeNull();
  });
  it('serves normally when the socket does not exist', async () => {
    const d = { ...deps(true), sockPath: '/nonexistent/tray.sock' };
    expect(await shellHandoff(docReq(), d)).toBeNull();
    expect(d.post).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/server && bunx vitest run src/shell-handoff.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/server/src/shell-handoff.ts
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

/** Appended to webview UAs by the mattstack window — compatibility contract. */
export const SHELL_UA_MARKER = ' mattstack-shell/';

export interface ShellHandoffDeps {
  sockPath?: string;
  timeoutMs?: number;
  post?: (sockPath: string, url: string, timeoutMs: number) => Promise<boolean>;
}

export function traySockPath(): string {
  return process.env.RT_APP_SOCKET ?? `${homedir()}/.mattstack/rt/tray.sock`;
}

async function postToTray(sockPath: string, url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch('http://tray/window/open', {
      // Bun extension: send the request over the tray's unix socket.
      unix: sockPath,
      method: 'POST',
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(timeoutMs),
    } as RequestInit & { unix: string });
    if (!res.ok) return false;
    const body = (await res.json()) as { handled?: boolean };
    return body.handled === true;
  } catch {
    return false;
  }
}

const stubPage = (host: string): string => `<!doctype html>
<meta charset="utf-8"><title>mattstack</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#16161e;color:#e3e7f6;font:14px -apple-system,sans-serif">
<div style="text-align:center">
  <p style="font-size:17px;margin:0 0 6px">opened in mattstack</p>
  <p style="color:#7e86ad;margin:0 0 14px">this page is showing in the mattstack window</p>
  <a href="?browser=1" style="color:#7aa2f7"
     onclick="document.cookie='mattstack_browser=1;path=/;max-age=31536000';location.href=location.pathname+location.search;return false">
    continue in browser instead</a>
</div>
<script>setTimeout(() => { try { window.close(); } catch {} }, 400);</script>`;

/**
 * Hands a top-level browser navigation on a .mattstack host to the
 * mattstack window (spec: 2026-09-15-mattstack-window-design.md §7).
 * Returns the stub Response to serve, or null to serve the app normally.
 * Every failure path returns null: fail open by construction.
 */
export async function shellHandoff(
  req: Request,
  deps: ShellHandoffDeps = {}
): Promise<Response | null> {
  if (req.method !== 'GET') return null;
  if (req.headers.get('upgrade')) return null;
  const forwarded = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!forwarded) return null;
  const host = forwarded.split(',')[0]!.trim().replace(/:\d+$/, '');
  if (!host.endsWith('.mattstack')) return null;
  const dest = req.headers.get('sec-fetch-dest');
  if (dest ? dest !== 'document' : !(req.headers.get('accept') ?? '').includes('text/html')) return null;
  if ((req.headers.get('user-agent') ?? '').includes(SHELL_UA_MARKER)) return null;
  const url = new URL(req.url);
  if (url.searchParams.get('browser') === '1') return null;
  if ((req.headers.get('cookie') ?? '').includes('mattstack_browser=1')) return null;
  const sockPath = deps.sockPath ?? traySockPath();
  if (!existsSync(sockPath)) return null;
  const target = `https://${host}${url.pathname}${url.search}`;
  const handled = await (deps.post ?? postToTray)(sockPath, target, deps.timeoutMs ?? 300);
  if (!handled) return null;
  return new Response(stubPage(host), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
```

Add the exports entry in `packages/server/package.json` after `"./canonical-host"`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/server && bunx vitest run src/shell-handoff.test.ts` — Expected: PASS (10 tests). Then `bun run typecheck` in `packages/server`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/shell-handoff.ts packages/server/src/shell-handoff.test.ts packages/server/package.json
git commit -m "app-server: add shellHandoff middleware helper"
```

---

### Task 9: Wire shellHandoff into createApp and board

**Files:**
- Modify: `packages/server/src/app.ts` (first middleware, after the canonical-host check)
- Modify: `packages/server/src/app.test.ts` (one wiring test)
- Modify: `apps/board/src/server.ts` (~line 807, right after the `canonicalHostRedirect` call)
- Modify: `packages/server/README.md` (exports table row for `./shell-handoff`)

**Interfaces:**
- Consumes: `shellHandoff` (Task 8).
- Produces: automatic handoff in chat, console, boxscore (via createApp) and board (manual call).

Ordering constraint: canonical-host redirect runs FIRST (a `.localhost` request 302s to `.mattstack`, and the handoff triggers on the re-request), then handoff, then routes.

- [ ] **Step 1: Write the failing wiring test**

Add to `packages/server/src/app.test.ts`, following its existing style of building `createApp` and dispatching Requests:

```ts
it('hands off top-level .mattstack document requests to the shell', async () => {
  const app = createApp({
    name: 'x', version: '0',
    routes: new Hono().get('/', c => c.text('app page')),
    shellHandoff: async () =>
      new Response('stub', { headers: { 'content-type': 'text/html' } }),
  });
  const res = await app.request('https://x.mattstack/');
  expect(await res.text()).toBe('stub');
});

it('serves normally when the shell declines', async () => {
  const app = createApp({
    name: 'x', version: '0',
    routes: new Hono().get('/', c => c.text('app page')),
    shellHandoff: async () => null,
  });
  const res = await app.request('https://x.mattstack/');
  expect(await res.text()).toBe('app page');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/server && bunx vitest run src/app.test.ts` — Expected: FAIL (unknown option `shellHandoff`).

- [ ] **Step 3: Implement the createApp wiring**

In `packages/server/src/app.ts`:

```ts
import { shellHandoff as defaultShellHandoff } from './shell-handoff';

export interface CreateAppOptions {
  name: string;
  version: string;
  /** The app's own Hono chain; `typeof routes` stays the RPC AppType. */
  routes: Hono;
  /** Test seam; production always uses the real helper. */
  shellHandoff?: (req: Request) => Promise<Response | null>;
}

export function createApp({ name, version, routes, shellHandoff = defaultShellHandoff }: CreateAppOptions): Hono {
  const app = new Hono()
    .use(async (c, next) => {
      const redirect = canonicalHostRedirect(c.req.raw);
      if (redirect) return redirect;
      const handoff = await shellHandoff(c.req.raw);
      if (handoff) return handoff;
      await next();
    })
    // ... rest unchanged ...
```

- [ ] **Step 4: Board's manual call**

In `apps/board/src/server.ts`, import next to the existing à-la-carte import (line 4):

```ts
import { shellHandoff } from '@mattstack/app-server/shell-handoff';
```

and in the fetch handler (line ~807):

```ts
const redirect = canonicalHostRedirect(req);
if (redirect) return redirect;
const handoff = await shellHandoff(req);
if (handoff) return handoff;
```

- [ ] **Step 5: Run the suites**

Run from repo root: `bun run tui-kit:build` (if the tree hasn't built it), then
`cd packages/server && bunx vitest run && bun run typecheck`, then
`bun run board:typecheck && bun run board:test`, then
`bun run chat:test && bun run console:test && bun run boxscore:test`.
Expected: all green (the helper no-ops in tests: no `.mattstack` host / no socket).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/app.test.ts packages/server/README.md apps/board/src/server.ts
git commit -m "app-server: wire shellHandoff into createApp; board calls it manually"
```

---

### Task 10: End-to-end manual verification (human-in-the-loop)

**Files:** none (verification only). Matt drives the parts that touch the installed app.

- [ ] **Step 1: Scratch build of the tray app**

From the repo-tools worktree: `cd rt-tray && ./build.sh release` builds `mattstack.app` **in the worktree** (never touch `/Applications/mattstack.app` or the main checkout's `mattstack-dev.app`). Then `bash check-bundle.sh --app mattstack.app` — Expected: all assertions pass, including the URL-scheme index-0 check.

- [ ] **Step 2: Window smoke (run from the worktree bundle or via dev-mode, Matt's call)**

- Gear menu → "Open mattstack": window opens, Dock icon appears, rail shows board/boxscore/chat/console/gitq + deck tile with green badge.
- Switch apps: instant after first visit (warm), no reload flash; ⌘2, ⌘R, tooltip, right-click Reload all work.
- Close window: Dock icon disappears (accessory restored). ctrl-opt-cmd-M reopens it.
- `open "mattstack://open/board"` and `open -a mattstack "https://console.mattstack/"` both land in the window.
- Stop deck (`deck` service) → reopen window: rail still renders from cache.
- Check Activity Monitor: note per-app WebContent memory with all five visited (the spec's "evaluate memory later" datapoint).

- [ ] **Step 3: Handoff smoke**

- With the worktree tray running and apps rebuilt on the new app-server: `curl -s -H "Sec-Fetch-Dest: document" -H "Accept: text/html" https://chat.mattstack/ | head -3` → expect the stub page while the toggle is on; the window selects chat.
- Click a real `https://board.mattstack` link in Slack/terminal → window takes it; browser tab shows the stub.
- "continue in browser" link → app serves normally; subsequent visits in that browser stay normal (cookie).
- Settings checkbox off → links open in the browser as before, instantly (no restarts).

- [ ] **Step 4: Ship prep**

- repo-tools: push the worktree branch, open the PR (repo-tools release flow ships the tray via Sparkle later).
- mattstack-apps: push branch, open PR. Apps pick up the middleware on their next deck-managed restart after merge.

---

## Self-review notes (already applied)

- Spec §2 tooltips/⌘n/deck tile → Task 5; §4 unknown-verb logging → Task 6's fall-through `TrayLog.warn`; §5 cache path + frame autosave → Tasks 2/5; §7 full matrix → Task 8 tests. Hotkey configurability is explicitly deferred by the amended spec.
- The `makeRoutes()` tuple arity in Task 3 is deliberately approximate ("adjust to current arity"): the factory's exact shape is in the file being edited.
- gitq: no task, per spec non-goals.
