import Foundation

public enum MainFrameVerdict: Equatable, Sendable {
    case allow
    case fail(status: Int)
}

public enum MainFrameResponse {
    /// Main frame only: a subframe or a background fetch answering 5xx must
    /// not cover a page that drew fine.
    public static func verdict(isMainFrame: Bool, status: Int?) -> MainFrameVerdict {
        guard isMainFrame, let status, (500...599).contains(status) else { return .allow }
        return .fail(status: status)
    }
}

public enum WindowReloadAction: Equatable, Sendable {
    case reload
    case load(URL)
    case nothing
}

public enum WindowReload {
    /// WKWebView.reload() does nothing without a committed page, which is the
    /// state a tab is left in when its first load failed or was cancelled.
    public static func action(failedURL: URL?, hasCommittedPage: Bool, home: URL?) -> WindowReloadAction {
        if let failedURL { return .load(failedURL) }
        if hasCommittedPage { return .reload }
        if let home { return .load(home) }
        return .nothing
    }
}

/// A served-app restart kickstarts each app in turn and returns before the
/// last ones listen again, so a tab that failed against one gets a few
/// spaced reloads rather than one that lands too early.
public enum FailedTabRetry {
    /// Seconds after the restart finished.
    public static let offsets: [TimeInterval] = [2, 5, 10]

    public static func run(offsets: [TimeInterval] = FailedTabRetry.offsets, sleep: (TimeInterval) async -> Void,
                           anyFailed: () async -> Bool, reload: () async -> Void) async {
        var elapsed: TimeInterval = 0
        for offset in offsets {
            await sleep(offset - elapsed)
            elapsed = offset
            guard await anyFailed() else { return }
            await reload()
        }
    }
}

public struct IconTarget: Equatable, Sendable {
    public let name: String
    public let url: String
    public init(name: String, url: String) {
        self.name = name
        self.url = url
    }
}

public struct IconPlan: Equatable, Sendable {
    public let fetchNow: [IconTarget]
    /// Missing icons whose fetch is already running, perhaps against an older
    /// catalog's URL: fetched once more only if that chain ends without one.
    public let afterInFlight: [IconTarget]
    public init(fetchNow: [IconTarget], afterInFlight: [IconTarget]) {
        self.fetchNow = fetchNow
        self.afterInFlight = afterInFlight
    }
}

public struct CatalogTake: Equatable, Sendable {
    /// The window shows something other than this list, or only a cache copy.
    public let apply: Bool
    /// The deck pid this list is now confirmed for; nil until a second fetch
    /// from the same deck returns the same apps.
    public let settledPid: String?
    public init(apply: Bool, settledPid: String?) {
        self.apply = apply
        self.settledPid = settledPid
    }
}

public enum CatalogRefresh {
    /// `currentIsFallback` is true when deck was shown only because the
    /// catalog was empty (a clean install before deck answered), not because
    /// anyone picked it.
    public static func activeApp(current: String, apps: [DiscoveryApp], deckName: String,
                                 currentIsFallback: Bool) -> String {
        if currentIsFallback { return apps.first?.name ?? deckName }
        if current == deckName || apps.contains(where: { $0.name == current }) { return current }
        return apps.first?.name ?? deckName
    }

    /// A fresh list holds only for the deck process that served it, and only
    /// once that process has served it twice: deck can answer /api/apps before
    /// its boot sweep has written every row, and at launch the other flavor's
    /// deck may still be the one answering. `currentPid` is what /healthz
    /// named just now, nil when deck did not answer.
    public static func needsRefetch(fresh: Bool, apps: [DiscoveryApp], settledPid: String?,
                                    currentPid: String?) -> Bool {
        guard fresh else { return true }
        guard let currentPid else { return false }
        return apps.isEmpty || settledPid != currentPid
    }

    public static func take(shown: [DiscoveryApp], shownFresh: Bool, shownPid: String?,
                            fetched: [DiscoveryApp], fetchedPid: String?) -> CatalogTake {
        let same = shownFresh && shown == fetched
        let settles = same && !fetched.isEmpty && fetchedPid != nil && shownPid == fetchedPid
        return CatalogTake(apply: !same, settledPid: settles ? fetchedPid : nil)
    }

    public static func iconPlan(apps: [DiscoveryApp], deck: IconTarget, loaded: Set<String>,
                                inFlight: Set<String>) -> IconPlan {
        let candidates = apps.compactMap { app in app.icon.map { IconTarget(name: app.name, url: $0) } } + [deck]
        let missing = candidates.filter { !loaded.contains($0.name) }
        return IconPlan(fetchNow: missing.filter { !inFlight.contains($0.name) },
                        afterInFlight: missing.filter { inFlight.contains($0.name) })
    }
}
