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
    private var ticking = false

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
        await model.ensureCatalogLoaded()
        let targets = model.apps.compactMap { app in
            BadgeParse.endpoint(for: app).map { (app.name, $0) }
        }
        let results = await withTaskGroup(of: (String, BadgeReading?).self) { group in
            for (name, url) in targets {
                group.addTask { (name, await Self.fetch(url)) }
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

    nonisolated private static func fetch(_ url: URL) async -> BadgeReading? {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
        request.httpMethod = "GET"
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return BadgeParse.parse(data)
    }
}
