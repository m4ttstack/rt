import Foundation
@testable import MattstackCore

private final class FakeFetcher: AppListFetching, @unchecked Sendable {
    var result: Result<Data, Error> = .failure(URLError(.notConnectedToInternet))
    func fetchAppsJSON() async throws -> Data { try result.get() }
}

private let sampleJSON = Data(#"""
{"apps":[{"name":"board","displayName":"Board","description":"MRs","url":"https://board.mattstack","icon":"https://deck.mattstack/api/apps/board/icon"},{"name":"chat","displayName":"Chat","description":null,"url":"https://chat.mattstack","icon":null}]}
"""#.utf8)

private func tmpCachePath() -> String {
    NSTemporaryDirectory() + "window-apps-cache-\(UUID().uuidString).json"
}

let appCatalogChecks: [Check] = [
    Check("decode parses the deck payload") { c in
        let apps = try AppCatalog.decode(sampleJSON)
        try c.requireEqual(apps.map(\.name), ["board", "chat"])
        try c.requireEqual(apps[0].url, "https://board.mattstack")
    },
    Check("load fetches, returns apps, and writes the cache") { c in
        let f = FakeFetcher(); f.result = .success(sampleJSON)
        let path = tmpCachePath()
        let apps = await AppCatalog(fetcher: f, cachePath: path).load()
        try c.requireEqual(apps.count, 2)
        c.expect(FileManager.default.fileExists(atPath: path))
    },
    Check("load falls back to the cache when fetch fails") { c in
        let path = tmpCachePath()
        try sampleJSON.write(to: URL(fileURLWithPath: path))
        let apps = await AppCatalog(fetcher: FakeFetcher(), cachePath: path).load()
        try c.requireEqual(apps.map(\.name), ["board", "chat"])
    },
    Check("load returns empty when fetch and cache both fail") { c in
        let apps = await AppCatalog(fetcher: FakeFetcher(), cachePath: tmpCachePath()).load()
        try c.requireEqual(apps, [])
    },
]
