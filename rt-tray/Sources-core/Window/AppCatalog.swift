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
