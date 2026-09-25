import AppKit
import Combine
import Foundation
import MattstackCore
import SwiftUI
import WebKit

struct URLSessionAppListFetcher: AppListFetching {
    func fetchAppsJSON() async throws -> Data {
        let request = URLRequest(url: URL(string: "https://deck.mattstack/api/apps")!,
                                 cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: DeckWaitTuning.catalogTimeout)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }
}

/// Reports a webview's failed navigation (a transport error or a main-frame
/// 5xx) back into the model keyed by app name, and intercepts cross-app
/// links (main-frame navigation or target=_blank) so a click inside one
/// app's webview activates the shell's own tab for the target app instead
/// of navigating in place.
/// WKWebView.navigationDelegate/uiDelegate are both weak, so the model
/// retains one of these per app for the life of the window.
@MainActor
final class WindowNavigationDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let appName: String
    private weak var model: WindowModel?

    init(appName: String, model: WindowModel) {
        self.appName = appName
        self.model = model
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        model?.store.noteFailedLoad(appName, url: (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL)
        model?.loadFailures[appName] = true
        model?.loadingApps.remove(appName)
    }

    /// Clears the overlay as soon as a new attempt starts, not just on
    /// success: a stuck-forever failure state otherwise survives right up
    /// until the retry completes.
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        model?.loadFailures[appName] = false
        model?.loadingApps.insert(appName)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        model?.store.noteLoaded(appName)
        model?.loadFailures[appName] = false
        model?.loadingApps.remove(appName)
    }

    /// WebKit treats any HTTP answer as a finished navigation, so without
    /// this a portless 502 page for an app that is not up yet sits in the
    /// tab with no overlay and no retry. Every other response keeps WebKit's
    /// own default, which declines a MIME type it cannot show.
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let http = navigationResponse.response as? HTTPURLResponse
        guard case .fail(let status) = MainFrameResponse.verdict(isMainFrame: navigationResponse.isForMainFrame,
                                                                  status: http?.statusCode) else {
            decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
            return
        }
        TrayLog.warn("window main-frame 5xx", [
            "app": appName, "status": status,
            "url": http?.url?.absoluteString ?? "(none)",
            "server": http?.value(forHTTPHeaderField: "Server") ?? "(none)",
        ])
        model?.store.noteFailedLoad(appName, url: http?.url)
        model?.loadFailures[appName] = true
        model?.loadingApps.remove(appName)
        decisionHandler(.cancel)
    }

    /// A same-window link to a different mattstack app (e.g. deck's own app
    /// listing) activates that app's tab in the shell instead of navigating
    /// this webview to it. A non-web scheme (vscode://, zed://, mailto:)
    /// goes to the OS: the webview would fail the navigation and paint the
    /// "Can't reach" overlay over a healthy page. Subframe navigation,
    /// non-mattstack hosts, and links back to this same app fall through to
    /// .allow untouched.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.targetFrame?.isMainFrame == true,
           let url = navigationAction.request.url,
           WindowNavigation.opensExternally(url) {
            decisionHandler(.cancel)
            NSWorkspace.shared.open(url)
            return
        }
        guard navigationAction.targetFrame?.isMainFrame == true,
              let url = navigationAction.request.url,
              let request = OpenLink.request(fromHTTPS: url),
              request.app != appName,
              let model = model,
              model.app(named: request.app) != nil
        else {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        Task { @MainActor in _ = await model.open(request) }
    }

    /// target=_blank to a mattstack app route the same way as an in-page
    /// link; target=_blank to an http/https URL opens in the default
    /// browser; a non-web scheme goes to the OS like an in-page one;
    /// anything else (about:blank, javascript:, an OAuth window.open
    /// prelude) is dropped with no browser popup. Either way no new
    /// WKWebView is created (nil), so a "new window" link never leaks a
    /// second webview outside the shell.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if let request = OpenLink.request(fromHTTPS: url), let model = model, model.app(named: request.app) != nil {
            Task { @MainActor in _ = await model.open(request) }
            return nil
        }
        let scheme = url.scheme?.lowercased()
        if scheme == "http" || scheme == "https" || WindowNavigation.opensExternally(url) {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}

@MainActor
final class WindowModel: ObservableObject {
    static let deckApp = DiscoveryApp(name: "deck", displayName: "Deck", description: nil,
                                       url: "https://deck.mattstack", icon: nil)

    @Published private(set) var apps: [DiscoveryApp] = []
    @Published private(set) var catalogFresh = false
    @Published var activeApp: String = ""
    @Published var loadFailures: [String: Bool] = [:]
    /// Apps whose webview has a navigation in flight, so the content area can
    /// say "loading" instead of showing a blank page.
    @Published var loadingApps: Set<String> = []
    @Published private(set) var icons: [String: NSImage] = [:]
    @Published private(set) var splashVisible = false
    @Published private(set) var splashOpacity: Double = 1
    @Published private(set) var deckWait: DeckWaitPhase = .waiting
    @Published private(set) var splashAnimationDone = false
    @Published var badges: [String: BadgeReading] = [:]

    let store: WebViewStore
    weak var controller: MattstackWindowController?

    private let backends: WindowBackends
    private let catalog: AppCatalog
    private var catalogLoadTask: Task<Void, Never>?
    private var catalogRefreshTask: Task<Void, Never>?
    private var catalogPid: String?
    private var catalogSettledPid: String?
    private var navigationDelegates: [String: WindowNavigationDelegate] = [:]
    private var iconFetchesInFlight: Set<String> = []
    private var iconRetryURLs: [String: String] = [:]
    private var deckWaitTask: Task<Void, Never>?
    private var deckWaitGeneration = 0
    private var activeAppIsFallback = false

    /// Process-lifetime, not instance-lifetime: only one `WindowModel` is
    /// ever constructed per process in practice, but the gate is spelled at
    /// the process level to say what it means -- re-shows of the window
    /// never replay the splash.
    private static var hasShownSplash = false
    private var splashDismissed = false

    init(store: WebViewStore? = nil, backends: WindowBackends = .live()) {
        self.store = store ?? WebViewStore()
        self.backends = backends
        self.catalog = backends.catalog
        fetchIcon(url: backends.deckFaviconURL, into: Self.deckApp.name)
    }

    var splashContent: SplashContent {
        SplashPresentation.content(animationDone: splashAnimationDone, phase: deckWait)
    }

    func app(named name: String) -> DiscoveryApp? {
        if name == Self.deckApp.name { return Self.deckApp }
        return apps.first { $0.name == name }
    }

    /// Shares one in-flight task across callers (show() and open() both call
    /// this) so a concurrent first show plus a deep-link open never fetch
    /// the catalog twice. Safe to call again after loading: the stored task
    /// is already resolved, so the await returns immediately.
    func ensureCatalogLoaded() async {
        if let existing = catalogLoadTask {
            await existing.value
            return
        }
        let task = Task { [weak self] in
            guard let self else { return }
            let result = await self.catalog.load()
            self.apps = result.apps
            self.catalogFresh = result.fresh
            // An empty catalog (deck unreachable, no cache) still needs an
            // active app or the content area shows nothing at all; the deck
            // pseudo-app always resolves via app(named:), and stands in only
            // until a fresh catalog names a first app.
            if self.activeApp.isEmpty {
                self.activeApp = result.apps.first?.name ?? Self.deckApp.name
                self.activeAppIsFallback = result.apps.isEmpty
            }
            for app in result.apps { self.fetchIcon(url: app.icon, into: app.name) }
        }
        catalogLoadTask = task
        await task.value
    }

    func refreshCatalogFromDeck() async {
        let pid: String?
        if case .healthy(let healthyPid) = await backends.deckProbe() { pid = healthyPid } else { pid = nil }
        await refreshCatalog(deckPid: pid)
    }

    /// `deckPid` is what deck's /healthz named just before this call, nil
    /// when it did not answer. True once the tabs come from a fresh list
    /// that deck served. Concurrent callers share one fetch.
    @discardableResult
    func refreshCatalog(deckPid: String?) async -> Bool {
        await ensureCatalogLoaded()
        if CatalogRefresh.needsRefetch(fresh: catalogFresh, apps: apps, settledPid: catalogSettledPid,
                                       currentPid: deckPid) {
            if let inFlight = catalogRefreshTask {
                await inFlight.value
            } else {
                let task = Task { [weak self] in
                    guard let self else { return }
                    let result = await self.catalog.load()
                    guard result.fresh else { return }
                    self.takeFreshCatalog(result.apps, deckPid: deckPid)
                }
                catalogRefreshTask = task
                await task.value
                if catalogRefreshTask == task { catalogRefreshTask = nil }
            }
        }
        return catalogFresh && (deckPid == nil || catalogPid == deckPid)
    }

    private func takeFreshCatalog(_ fetched: [DiscoveryApp], deckPid: String?) {
        let take = CatalogRefresh.take(shown: apps, shownFresh: catalogFresh, shownPid: catalogPid,
                                       fetched: fetched, fetchedPid: deckPid)
        catalogPid = deckPid
        catalogSettledPid = take.settledPid
        if take.apply { applyFreshCatalog(fetched) }
    }

    private func applyFreshCatalog(_ fresh: [DiscoveryApp]) {
        apps = fresh
        catalogFresh = true
        activeApp = CatalogRefresh.activeApp(current: activeApp, apps: fresh, deckName: Self.deckApp.name,
                                             currentIsFallback: activeAppIsFallback)
        activeAppIsFallback = fresh.isEmpty
        TrayLog.info("window catalog refreshed", ["apps": fresh.map(\.name).joined(separator: ",")])
        let deck = IconTarget(name: Self.deckApp.name, url: backends.deckFaviconURL)
        let plan = CatalogRefresh.iconPlan(apps: fresh, deck: deck, loaded: Set(icons.keys),
                                           inFlight: iconFetchesInFlight)
        for target in plan.fetchNow { fetchIcon(url: target.url, into: target.name) }
        for target in plan.afterInFlight { iconRetryURLs[target.name] = target.url }
    }

    func open(_ request: OpenRequest) async -> Bool {
        await ensureCatalogLoaded()
        guard let dest = WindowNavigation.destination(for: request, in: apps + [Self.deckApp]),
              let app = app(named: request.app) else { return false }
        controller?.show()
        select(app.name)
        if !request.pathAndQuery.isEmpty {
            webView(for: app).load(URLRequest(url: dest))
        }
        return true
    }

    func select(_ name: String) {
        activeApp = name
        activeAppIsFallback = false
    }

    /// Opens the oldest counted decision.
    func openBadge(for name: String) {
        guard let path = badges[name]?.path else { select(name); return }
        Task { _ = await open(OpenRequest(app: name, pathAndQuery: path)) }
    }

    func firstBadgedRequest() -> OpenRequest? {
        BadgeBook.firstBadged(badges, order: apps.map(\.name))
    }

    /// The splash covers the whole window until its own animation has played
    /// and deck is ready (/healthz answered and a fresh catalog loaded), or
    /// until the deck wait gives up and the splash says why. It plays once
    /// per process; re-showing a window whose wait gave up starts the wait
    /// again instead of replaying it.
    func presentSplashIfNeeded() {
        guard !Self.hasShownSplash else {
            if case .unreachable = deckWait { retryDeckWait() }
            return
        }
        Self.hasShownSplash = true
        splashVisible = true

        let visibleNanoseconds = UInt64(SplashTuning.minimumVisibleDuration * 1_000_000_000)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: visibleNanoseconds)
            self?.splashAnimationDone = true
            self?.dismissSplashIfReady()
        }
        startDeckWait()
    }

    func retryDeckWait() {
        deckWait = .waiting
        startDeckWait()
    }

    /// A Retry starts a new wait while the old one may still be sleeping, so
    /// only the latest generation may publish its result.
    private func startDeckWait() {
        deckWaitTask?.cancel()
        deckWaitGeneration += 1
        let generation = deckWaitGeneration
        let backends = backends
        let deps = DeckWaitDeps(
            probe: backends.deckProbe,
            loadCatalog: { [weak self] pid in await self?.refreshCatalog(deckPid: pid) ?? false },
            diagnoseAgent: backends.diagnoseDeckAgent,
            now: { ProcessInfo.processInfo.systemUptime },
            sleep: { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) })
        let started = ProcessInfo.processInfo.systemUptime
        deckWaitTask = Task { [weak self] in
            let phase = await DeckWait.run(deadline: backends.deckWaitDeadline, deps: deps)
            guard let self, generation == self.deckWaitGeneration, phase != .waiting else { return }
            self.finishDeckWait(phase, seconds: ProcessInfo.processInfo.systemUptime - started)
        }
    }

    private func finishDeckWait(_ phase: DeckWaitPhase, seconds: TimeInterval) {
        deckWait = phase
        switch phase {
        case .ready:
            TrayLog.info("window: deck ready", ["seconds": Int(seconds)])
            reloadFailedTabs()
        case .unreachable(let reason):
            TrayLog.warn("window: deck unreachable", ["seconds": Int(seconds), "reason": reason])
        case .waiting:
            break
        }
        dismissSplashIfReady()
    }

    private func dismissSplashIfReady() {
        if splashContent == .dismiss { dismissSplash() }
    }

    /// Tabs mount under the splash, so one can fail against an app that
    /// was still starting before deck was ready.
    private func reloadFailedTabs() {
        for (name, failed) in loadFailures where failed { store.reload(name) }
    }

    /// A served-app restart runs after deck's ready reload, so a tab that
    /// failed against a restarting app has nothing else to reload it.
    func retryFailedTabsAfterServedAppsRestart() async {
        await FailedTabRetry.run(sleep: { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) },
                                 anyFailed: { self.loadFailures.values.contains(true) },
                                 reload: {
                                     TrayLog.info("window: reloading tabs that failed during a served-app restart")
                                     self.reloadFailedTabs()
                                 })
    }

    /// Deterministic fade, not a conditional-removal `.transition`: a plain
    /// `if splashVisible` conditional pops the instant the flag flips
    /// (that removal isn't guaranteed to pick up an ambient `.animation`),
    /// so instead this animates the published `splashOpacity` to 0 first --
    /// `splashOpacity` reaches its target value synchronously here even
    /// though the on-screen pixels are still interpolating, which is also
    /// what makes an `allowsHitTesting(splashOpacity > 0)` binding in the
    /// view disable clicks on the splash the instant the fade starts, not
    /// at the end of it -- and only removes the view (`splashVisible =
    /// false`) once that fade duration has actually elapsed.
    private func dismissSplash() {
        guard !splashDismissed else { return }
        splashDismissed = true
        withAnimation(.easeOut(duration: SplashTuning.dismissFadeDuration)) {
            splashOpacity = 0
        }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(SplashTuning.dismissFadeDuration * 1_000_000_000))
            self?.splashVisible = false
        }
    }

    func toggleVisibility() {
        guard let window = controller?.window, window.isKeyWindow, window.isVisible else {
            controller?.show()
            return
        }
        controller?.close()
    }

    /// Mounted by the content view too; attaching failure tracking here as
    /// well covers a deep-link load that reaches the view before it mounts.
    func webView(for app: DiscoveryApp) -> WKWebView {
        let view = store.view(for: app)
        trackFailures(for: view, appName: app.name)
        return view
    }

    func findContainer(for app: DiscoveryApp) -> FindBarContainer {
        let container = store.container(for: app)
        trackFailures(for: container.webView, appName: app.name)
        return container
    }

    /// The find bar belongs to whichever tab is showing, so a ⌘F that reaches
    /// the window instead of the web content (nothing in the page focused
    /// yet) still opens the right one. Nil only before the catalog resolves
    /// an active app, when there is no page to search.
    var activeFindContainer: FindBarContainer? {
        guard let app = app(named: activeApp) else { return nil }
        return findContainer(for: app)
    }

    func trackFailures(for view: WKWebView, appName: String) {
        guard navigationDelegates[appName] == nil else { return }
        let delegate = WindowNavigationDelegate(appName: appName, model: self)
        navigationDelegates[appName] = delegate
        view.navigationDelegate = delegate
        view.uiDelegate = delegate
        // The store starts a webview's first load when it builds it, which is
        // a moment before this delegate exists. Seeding from the webview's own
        // state, rather than assuming, keeps the indicator honest for a view
        // that somehow arrives already idle.
        if view.isLoading { loadingApps.insert(appName) }
    }

    /// A failure is retried, and what came back is logged well enough to
    /// name the culprit: a byte count alone said only that it was not an
    /// image. A fresh catalog asks again for any icon still missing, so one
    /// name is never fetched twice at once; a chain that was already running
    /// and ends empty-handed gets one more go at the fresh catalog's URL.
    private func fetchIcon(url urlString: String?, into name: String) {
        guard icons[name] == nil, !iconFetchesInFlight.contains(name),
              let urlString, let url = URL(string: urlString) else { return }
        iconFetchesInFlight.insert(name)
        Task { [weak self] in
            var image: NSImage?
            for attempt in 1...Self.iconFetchAttempts {
                image = await Self.loadIcon(url: url, app: name, attempt: attempt)
                guard image == nil, attempt < Self.iconFetchAttempts else { break }
                try? await Task.sleep(nanoseconds: UInt64(Self.iconRetryDelay(attempt) * 1_000_000_000))
            }
            guard let self else { return }
            self.iconFetchesInFlight.remove(name)
            let retryURL = self.iconRetryURLs.removeValue(forKey: name)
            if let image {
                self.icons[name] = image
            } else if let retryURL {
                self.fetchIcon(url: retryURL, into: name)
            }
        }
    }

    private static let iconFetchAttempts = 4

    /// 1s, 3s, 9s: long enough in total (13s) to outlast a service that is
    /// still coming up when the window opens, short enough that a tab does
    /// not wear a letter for a noticeable part of a session.
    private static func iconRetryDelay(_ attempt: Int) -> Double {
        pow(3, Double(attempt - 1))
    }

    private static func loadIcon(url: URL, app: String, attempt: Int) async -> NSImage? {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(from: url)
        } catch {
            TrayLog.warn("window icon fetch failed", [
                "app": app, "url": url.absoluteString, "attempt": attempt,
                "error": String(describing: error),
            ])
            return nil
        }
        if let image = NSImage(data: data) { return image }
        let http = response as? HTTPURLResponse
        TrayLog.warn("window icon decode failed", [
            "app": app, "url": url.absoluteString, "attempt": attempt,
            "bytes": data.count,
            "status": http?.statusCode ?? -1,
            "contentType": http?.value(forHTTPHeaderField: "Content-Type") ?? "(none)",
            "finalUrl": http?.url?.absoluteString ?? "(none)",
            // The first line of a served error page usually names its author.
            "head": String(decoding: data.prefix(120), as: UTF8.self)
                .replacingOccurrences(of: "\n", with: " "),
        ])
        return nil
    }
}
