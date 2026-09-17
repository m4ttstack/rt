import AppKit
import Combine
import Foundation
import MattstackCore
import SwiftUI
import WebKit

struct URLSessionAppListFetcher: AppListFetching {
    func fetchAppsJSON() async throws -> Data {
        try await URLSession.shared.data(from: URL(string: "https://deck.mattstack/api/apps")!).0
    }
}

/// Reports a webview's provisional-navigation failure back into the model
/// keyed by app name, and intercepts cross-app links (main-frame navigation
/// or target=_blank) so a click inside one app's webview activates the
/// shell's own tab for the target app instead of navigating in place.
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
        model?.loadFailures[appName] = false
        model?.loadingApps.remove(appName)
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

    let store: WebViewStore
    weak var controller: MattstackWindowController?

    private let catalog: AppCatalog
    private var catalogLoadTask: Task<Void, Never>?
    private var navigationDelegates: [String: WindowNavigationDelegate] = [:]

    /// Process-lifetime, not instance-lifetime: only one `WindowModel` is
    /// ever constructed per process in practice, but the gate is spelled at
    /// the process level to say what it means -- re-shows of the window
    /// never replay the splash.
    private static var hasShownSplash = false
    private var splashDismissed = false

    init(store: WebViewStore? = nil) {
        self.store = store ?? WebViewStore()
        self.catalog = AppCatalog(fetcher: URLSessionAppListFetcher(),
                                   cachePath: AppHome.current + "/.mattstack/rt/window-apps-cache.json")
        fetchIcon(url: "https://deck.mattstack/favicon.svg", into: Self.deckApp.name)
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
            // pseudo-app always resolves via app(named:), and its own
            // navigation finishing still satisfies the splash gate instead
            // of holding it for the full 8s cap.
            if self.activeApp.isEmpty { self.activeApp = result.apps.first?.name ?? Self.deckApp.name }
            for app in result.apps { self.fetchIcon(url: app.icon, into: app.name) }
        }
        catalogLoadTask = task
        await task.value
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
    }

    /// No-op on every call after the first per process: `show()` calls this
    /// unconditionally on every window show, including re-shows.
    ///
    /// The splash lives for exactly as long as its own animation takes
    /// (`SplashTuning.minimumVisibleDuration`, kept there so it stays in
    /// lockstep with the animation's tunables) and then goes, whatever the
    /// network is doing. It used to also wait on the active app's first
    /// navigation, which made an unremarkable catalog fetch or page load read
    /// as a stuck splash -- and waited on the wrong thing anyway, since a
    /// finished navigation is not a drawn page. Content that is not ready yet
    /// says so itself, in the content area.
    func presentSplashIfNeeded() {
        guard !Self.hasShownSplash else { return }
        Self.hasShownSplash = true
        splashVisible = true

        let visibleNanoseconds = UInt64(SplashTuning.minimumVisibleDuration * 1_000_000_000)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: visibleNanoseconds)
            self?.dismissSplash()
        }
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

    private func fetchIcon(url urlString: String?, into name: String) {
        guard icons[name] == nil, let urlString, let url = URL(string: urlString) else { return }
        Task { [weak self] in
            let data: Data
            do {
                data = try await URLSession.shared.data(from: url).0
            } catch {
                TrayLog.warn("window icon fetch failed", ["app": name, "url": urlString, "error": String(describing: error)])
                return
            }
            guard let image = NSImage(data: data) else {
                TrayLog.warn("window icon decode failed", ["app": name, "url": urlString, "bytes": data.count])
                return
            }
            self?.icons[name] = image
        }
    }
}
