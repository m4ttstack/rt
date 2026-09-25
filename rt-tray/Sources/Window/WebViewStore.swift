import MattstackCore
import WebKit

/// One warm WKWebView per visited app, alive for the window's lifetime.
/// All views share the default website data store so the estate behaves
/// like one browser profile.
@MainActor
final class WebViewStore {
    /// Appended to the default UA by WebKit. The app-server handoff
    /// middleware matches " mattstack-shell/" (compatibility contract).
    static var shellUserAgentSuffix: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        return "mattstack-shell/\(version)"
    }

    private var views: [String: WKWebView] = [:]
    private var containers: [String: FindBarContainer] = [:]
    private var homeURLs: [String: URL] = [:]
    private var failedURLs: [String: URL] = [:]

    /// What the window actually mounts: the webview wrapped in its own find
    /// bar container, so every tab carries its own ⌘F state for the window's
    /// lifetime the same way it carries its own scroll position.
    func container(for app: DiscoveryApp) -> FindBarContainer {
        if let existing = containers[app.name] { return existing }
        let container = FindBarContainer(webView: view(for: app))
        containers[app.name] = container
        return container
    }

    func existingContainer(for name: String) -> FindBarContainer? { containers[name] }

    func view(for app: DiscoveryApp) -> WKWebView {
        if let existing = views[app.name] { return existing }
        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = Self.shellUserAgentSuffix
        config.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: config)
        view.allowsBackForwardNavigationGestures = true
        // underPageBackgroundColor stays at its default, which WebKit derives
        // from the page. Pinning it to the shell's dark chrome also fills the
        // scroller gutter of any page that reserves one, and macOS draws a
        // light page's thumb as translucent black -- invisible against it.
        // LoadingOverlay is what covers a tab's first paint.
        if let url = URL(string: app.url) {
            homeURLs[app.name] = url
            view.load(URLRequest(url: url))
        }
        views[app.name] = view
        return view
    }

    func existingView(for name: String) -> WKWebView? { views[name] }

    func noteFailedLoad(_ name: String, url: URL?) {
        if let url { failedURLs[name] = url }
    }

    func noteLoaded(_ name: String) { failedURLs[name] = nil }

    func reload(_ name: String) {
        guard let view = views[name] else { return }
        switch WindowReload.action(failedURL: failedURLs.removeValue(forKey: name),
                                   hasCommittedPage: view.backForwardList.currentItem != nil,
                                   home: homeURLs[name]) {
        case .reload: view.reload()
        case .load(let url): view.load(URLRequest(url: url))
        case .nothing: break
        }
    }
}
