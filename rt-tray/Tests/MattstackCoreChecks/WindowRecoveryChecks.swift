import Foundation
@testable import MattstackCore

private func app(_ name: String, icon: String? = nil) -> DiscoveryApp {
    DiscoveryApp(name: name, displayName: name.capitalized, description: nil,
                 url: "https://\(name).mattstack", icon: icon)
}

private let deckIcon = IconTarget(name: "deck", url: "https://deck.mattstack/favicon.svg")

let windowRecoveryChecks: [Check] = [
    Check("window recovery: a main-frame 5xx fails the tab") { c in
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 502), .fail(status: 502))
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 500), .fail(status: 500))
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 599), .fail(status: 599))
    },
    Check("window recovery: subframe 5xx, 4xx, 2xx and non-HTTP responses pass through") { c in
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: false, status: 502), .allow)
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 404), .allow)
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 200), .allow)
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: 600), .allow)
        c.expectEqual(MainFrameResponse.verdict(isMainFrame: true, status: nil), .allow)
    },
    Check("window recovery: retry after a failed first load loads the app, not reload()") { c in
        let home = URL(string: "https://board.mattstack")!
        c.expectEqual(WindowReload.action(failedURL: nil, hasCommittedPage: false, home: home), .load(home))
    },
    Check("window recovery: retry loads the URL that failed, not the last good page") { c in
        let failed = URL(string: "https://board.mattstack/mrs/42")!
        c.expectEqual(WindowReload.action(failedURL: failed, hasCommittedPage: true,
                                          home: URL(string: "https://board.mattstack")), .load(failed))
    },
    Check("window recovery: a healthy page reloads in place") { c in
        c.expectEqual(WindowReload.action(failedURL: nil, hasCommittedPage: true, home: nil), .reload)
        c.expectEqual(WindowReload.action(failedURL: nil, hasCommittedPage: false, home: nil), .nothing)
    },
    Check("window recovery: an app gone from the fresh catalog moves the active tab") { c in
        c.expectEqual(CatalogRefresh.activeApp(current: "gitq", apps: [app("board"), app("chat")], deckName: "deck",
                                               currentIsFallback: false), "board")
        c.expectEqual(CatalogRefresh.activeApp(current: "gitq", apps: [], deckName: "deck",
                                               currentIsFallback: false), "deck")
    },
    Check("window recovery: an active tab still in the catalog, or a chosen deck, stays put") { c in
        c.expectEqual(CatalogRefresh.activeApp(current: "chat", apps: [app("board"), app("chat")], deckName: "deck",
                                               currentIsFallback: false), "chat")
        c.expectEqual(CatalogRefresh.activeApp(current: "deck", apps: [app("board")], deckName: "deck",
                                               currentIsFallback: false), "deck")
        c.expectEqual(CatalogRefresh.activeApp(current: "", apps: [app("board")], deckName: "deck",
                                               currentIsFallback: false), "board")
    },
    Check("window recovery: deck shown only because the catalog was empty gives way to the first fresh app") { c in
        c.expectEqual(CatalogRefresh.activeApp(current: "deck", apps: [app("board"), app("chat")], deckName: "deck",
                                               currentIsFallback: true), "board")
        c.expectEqual(CatalogRefresh.activeApp(current: "deck", apps: [], deckName: "deck",
                                               currentIsFallback: true), "deck")
    },
    Check("window recovery: a fresh catalog re-fetches only missing icons, deck's included") { c in
        let apps = [app("board", icon: "https://deck.mattstack/api/apps/board/icon"),
                    app("chat", icon: "https://deck.mattstack/api/apps/chat/icon"),
                    app("console")]
        let targets = CatalogRefresh.iconTargets(apps: apps, deck: deckIcon, loaded: ["board"], inFlight: [])
        c.expectEqual(targets.map(\.name), ["chat", "deck"])
    },
    Check("window recovery: an icon fetch already in flight is not doubled") { c in
        let apps = [app("board", icon: "https://deck.mattstack/api/apps/board/icon")]
        c.expectEqual(CatalogRefresh.iconTargets(apps: apps, deck: deckIcon, loaded: [], inFlight: ["board", "deck"]), [])
    },
]
