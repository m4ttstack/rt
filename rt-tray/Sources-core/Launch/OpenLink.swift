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
    /// mattstack://open/<app>[/<path...>][?query][#fragment]
    public static func request(from url: URL) -> OpenRequest? {
        guard url.scheme?.lowercased() == "mattstack", url.host?.lowercased() == "open" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard let app = parts.first, !app.isEmpty else { return nil }
        var rest = parts.count > 1 ? "/" + parts.dropFirst().joined(separator: "/") : ""
        if let q = url.query, !q.isEmpty { rest += "?" + q }
        if let f = url.fragment, !f.isEmpty { rest += "#" + f }
        return OpenRequest(app: app.lowercased(), pathAndQuery: rest)
    }

    /// https://<app>.mattstack[/<path...>][?query][#fragment], single label only.
    public static func request(fromHTTPS url: URL) -> OpenRequest? {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        guard let host = url.host?.lowercased(), host.hasSuffix(".mattstack") else { return nil }
        let app = String(host.dropLast(".mattstack".count))
        guard !app.isEmpty, !app.contains(".") else { return nil }
        var rest = url.path == "/" || url.path.isEmpty ? "" : url.path
        if let q = url.query, !q.isEmpty { rest += "?" + q }
        if let f = url.fragment, !f.isEmpty { rest += "#" + f }
        return OpenRequest(app: app, pathAndQuery: rest)
    }
}

public enum WindowNavigation {
    public static func destination(for request: OpenRequest, in apps: [DiscoveryApp]) -> URL? {
        guard let app = apps.first(where: { $0.name == request.app }) else { return nil }
        return URL(string: app.url + request.pathAndQuery)
    }
}
