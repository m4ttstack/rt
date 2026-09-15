import Foundation

public protocol AppListFetching: Sendable {
    func fetchAppsJSON() async throws -> Data
}

public struct CatalogLoad: Equatable, Sendable {
    public let apps: [DiscoveryApp]
    /// True only when the network fetch itself succeeded and decoded; a
    /// cache-fallback or empty result both report false, so callers can
    /// tell "we have last-known-good apps" from "the catalog is live".
    public let fresh: Bool
    public init(apps: [DiscoveryApp], fresh: Bool) {
        self.apps = apps
        self.fresh = fresh
    }
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

    public func load() async -> CatalogLoad {
        if let data = try? await fetcher.fetchAppsJSON(), let apps = try? Self.decode(data) {
            try? data.write(to: URL(fileURLWithPath: cachePath), options: .atomic)
            return CatalogLoad(apps: apps, fresh: true)
        }
        guard let cached = FileManager.default.contents(atPath: cachePath),
              let apps = try? Self.decode(cached) else { return CatalogLoad(apps: [], fresh: false) }
        return CatalogLoad(apps: apps, fresh: false)
    }
}
