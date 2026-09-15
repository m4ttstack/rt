import MattstackCore
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
