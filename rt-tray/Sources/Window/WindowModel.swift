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
        // A dead app's failed load still counts as its "first navigation
        // finishing" for the splash gate, or a dead app would hold the
        // splash for the full 8s hard cap instead of dismissing at the
        // normal minimum-visible time with the error overlay ready beneath.
        model?.reportFirstNavigationFinish(appName: appName)
    }

    /// Clears the overlay as soon as a new attempt starts, not just on
    /// success: a stuck-forever failure state otherwise survives right up
    /// until the retry completes.
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        model?.loadFailures[appName] = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        model?.loadFailures[appName] = false
        model?.reportFirstNavigationFinish(appName: appName)
    }

    /// A same-window link to a different mattstack app (e.g. deck's own app
    /// listing) activates that app's tab in the shell instead of navigating
    /// this webview to it. Subframe navigation, non-mattstack hosts, and
    /// links back to this same app fall through to .allow untouched.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
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
    /// browser; anything else (about:blank, javascript:, an OAuth
    /// window.open prelude) is dropped with no browser popup. Either way no
    /// new WKWebView is created (nil), so a "new window" link never leaks a
    /// second webview outside the shell.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if let request = OpenLink.request(fromHTTPS: url), let model = model, model.app(named: request.app) != nil {
            Task { @MainActor in _ = await model.open(request) }
            return nil
        }
        if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
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
    private var splashMinDelayElapsed = false
    private var splashNavigationFinished = false
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
    /// unconditionally on every window show, including re-shows. The
    /// minimum-display gate is `SplashTuning.minimumVisibleDuration`
    /// (animation settle + a post-settle hold), not a bare literal here, so
    /// it stays in lockstep with the animation's own tunables.
    func presentSplashIfNeeded() {
        guard !Self.hasShownSplash else { return }
        Self.hasShownSplash = true
        splashVisible = true

        let minimumVisibleNanoseconds = UInt64(SplashTuning.minimumVisibleDuration * 1_000_000_000)
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: minimumVisibleNanoseconds)
            self?.splashMinDelayElapsed = true
            self?.dismissSplashIfReady()
        }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            self?.dismissSplash()
        }
    }

    /// The gate is "the active app's first navigation finishing", checked
    /// live against `activeApp` rather than a name captured at splash-show
    /// time, since the active app is often still unresolved (catalog not
    /// loaded yet) at that moment.
    func reportFirstNavigationFinish(appName: String) {
        guard splashVisible, appName == activeApp else { return }
        splashNavigationFinished = true
        dismissSplashIfReady()
    }

    private func dismissSplashIfReady() {
        guard splashMinDelayElapsed, splashNavigationFinished else { return }
        dismissSplash()
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

    func trackFailures(for view: WKWebView, appName: String) {
        guard navigationDelegates[appName] == nil else { return }
        let delegate = WindowNavigationDelegate(appName: appName, model: self)
        navigationDelegates[appName] = delegate
        view.navigationDelegate = delegate
        view.uiDelegate = delegate
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
