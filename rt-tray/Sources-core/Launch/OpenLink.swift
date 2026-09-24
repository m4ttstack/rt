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
    public let badge: String?
    public init(name: String, displayName: String, description: String?, url: String, icon: String?,
                badge: String? = nil) {
        self.name = name; self.displayName = displayName
        self.description = description; self.url = url; self.icon = icon
        self.badge = badge
    }
}

public enum OpenLink {
    /// mattstack://open/<app>[/<path...>][?query][#fragment]
    ///
    /// Built on `URLComponents`' percent-encoded accessors, not `URL.path` /
    /// `.pathComponents` (which decode each component and so collapse an
    /// encoded `%2F` inside a segment into a literal `/`, corrupting the
    /// segment split before `WindowNavigation.destination` ever re-parses
    /// it). Only the isolated app-name segment gets decoded; the rest of the
    /// path, the query, and the fragment stay percent-encoded end to end.
    public static func request(from url: URL) -> OpenRequest? {
        guard url.scheme?.lowercased() == "mattstack", url.host?.lowercased() == "open" else { return nil }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let segments = components.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard let encodedApp = segments.first, let app = encodedApp.removingPercentEncoding, !app.isEmpty else { return nil }
        var rest = segments.count > 1 ? "/" + segments.dropFirst().joined(separator: "/") : ""
        if let q = components.percentEncodedQuery, !q.isEmpty { rest += "?" + q }
        if let f = components.percentEncodedFragment, !f.isEmpty { rest += "#" + f }
        return OpenRequest(app: app.lowercased(), pathAndQuery: rest)
    }

    /// https://<app>.mattstack[/<path...>][?query][#fragment], single label only.
    /// Same percent-encoding-preserving approach as `request(from:)` above.
    public static func request(fromHTTPS url: URL) -> OpenRequest? {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        guard let host = url.host?.lowercased(), host.hasSuffix(".mattstack") else { return nil }
        let app = String(host.dropLast(".mattstack".count))
        guard !app.isEmpty, !app.contains(".") else { return nil }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let encodedPath = components.percentEncodedPath
        var rest = encodedPath.isEmpty || encodedPath == "/" ? "" : encodedPath
        if let q = components.percentEncodedQuery, !q.isEmpty { rest += "?" + q }
        if let f = components.percentEncodedFragment, !f.isEmpty { rest += "#" + f }
        return OpenRequest(app: app, pathAndQuery: rest)
    }
}

public enum WindowNavigation {
    public static func destination(for request: OpenRequest, in apps: [DiscoveryApp]) -> URL? {
        guard let app = apps.first(where: { $0.name == request.app }) else { return nil }
        return URL(string: app.url + request.pathAndQuery)
    }

    /// Schemes WKWebView can load (or resolve in-page) itself. Anything else
    /// (vscode://, zed://, mailto:, mattstack://, ...) must be handed to the
    /// OS: allowing the navigation makes the webview fail it, and a failed
    /// main-frame load paints the app's "Can't reach" overlay over a page
    /// that is perfectly healthy.
    private static let webviewNativeSchemes: Set<String> = [
        "http", "https", "about", "blob", "data", "javascript", "file",
    ]

    public static func opensExternally(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return !webviewNativeSchemes.contains(scheme)
    }
}
