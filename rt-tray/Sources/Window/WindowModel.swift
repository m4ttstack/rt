import AppKit
import Combine
import Foundation
import MattstackCore
import WebKit

struct URLSessionAppListFetcher: AppListFetching {
    func fetchAppsJSON() async throws -> Data {
        try await URLSession.shared.data(from: URL(string: "https://deck.mattstack/api/apps")!).0
    }
}

/// Reports a webview's provisional-navigation failure back into the model
/// keyed by app name. WKWebView.navigationDelegate is weak, so the model
/// retains one of these per app for the life of the window.
@MainActor
final class WindowNavigationDelegate: NSObject, WKNavigationDelegate {
    private let appName: String
    private weak var model: WindowModel?

    init(appName: String, model: WindowModel) {
        self.appName = appName
        self.model = model
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        model?.loadFailures[appName] = true
    }

    /// Clears the overlay as soon as a new attempt starts, not just on
    /// success: a stuck-forever failure state otherwise survives right up
    /// until the retry completes.
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        model?.loadFailures[appName] = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        model?.loadFailures[appName] = false
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

    let store: WebViewStore
    weak var controller: MattstackWindowController?

    private let catalog: AppCatalog
    private var catalogLoadTask: Task<Void, Never>?
    private var navigationDelegates: [String: WindowNavigationDelegate] = [:]

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
            if self.activeApp.isEmpty, let first = result.apps.first { self.activeApp = first.name }
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
