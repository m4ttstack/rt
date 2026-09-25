import AppKit
import MattstackCore

/// Its own timer, not the daemon status tick: that path returns early when
/// the daemon is down and holds an in-flight latch, and a slow app must not
/// delay health.
@MainActor
final class BadgePoller {
    private weak var model: WindowModel?
    private var timer: Timer?
    private var book = BadgeBook()
    private var sessions = PerHostPool<URLSession>()
    private var ticking = false

    nonisolated private static let requestTimeout: TimeInterval = 2

    init(model: WindowModel) {
        self.model = model
    }

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.tick() }
        }
        Task { await tick() }
    }

    private func tick() async {
        guard !ticking, let model else { return }
        ticking = true
        defer { ticking = false }
        await model.refreshCatalogFromDeck()
        let endpoints = model.apps.compactMap { app in
            BadgeParse.endpoint(for: app).map { (app.name, $0) }
        }
        for dropped in sessions.retain(urls: endpoints.map(\.1)) { dropped.invalidateAndCancel() }
        let targets = endpoints.compactMap { name, url in
            sessions.value(for: url, make: Self.makeSession).map { (name, url, $0) }
        }
        let results = await withTaskGroup(of: (String, BadgeReading?).self) { group in
            for (name, url, session) in targets {
                group.addTask { (name, await Self.fetch(url, session: session)) }
            }
            var out: [(String, BadgeReading?)] = []
            for await result in group { out.append(result) }
            return out
        }
        book.retain(apps: Set(targets.map(\.0)))
        for (name, reading) in results { book.record(app: name, reading: reading) }
        if model.badges != book.readings { model.badges = book.readings }
        NSApp.dockTile.badgeLabel = BadgeBook.label(book.total)
    }

    /// Every *.mattstack host is the same local proxy, so on a shared session
    /// CFNetwork coalesces a badge request onto the HTTP/2 connection already
    /// open for deck (or another app) and the badge host's TLS trust
    /// evaluation fails. A session per host gives each app its own pool.
    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = requestTimeout * 2
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        return URLSession(configuration: config)
    }

    nonisolated private static func fetch(_ url: URL, session: URLSession) async -> BadgeReading? {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: requestTimeout)
        request.httpMethod = "GET"
        guard let (data, response) = try? await session.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return BadgeParse.parse(data)
    }
}
