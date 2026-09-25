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

public struct IconTarget: Equatable, Sendable {
    public let name: String
    public let url: String
    public init(name: String, url: String) {
        self.name = name
        self.url = url
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

    public static func iconTargets(apps: [DiscoveryApp], deck: IconTarget, loaded: Set<String>,
                                   inFlight: Set<String>) -> [IconTarget] {
        let candidates = apps.compactMap { app in app.icon.map { IconTarget(name: app.name, url: $0) } } + [deck]
        return candidates.filter { !loaded.contains($0.name) && !inFlight.contains($0.name) }
    }
}
