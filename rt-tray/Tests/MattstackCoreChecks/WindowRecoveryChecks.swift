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
        let plan = CatalogRefresh.iconPlan(apps: apps, deck: deckIcon, loaded: ["board"], inFlight: [])
        c.expectEqual(plan.fetchNow.map(\.name), ["chat", "deck"])
        c.expectEqual(plan.afterInFlight, [])
    },
    Check("window recovery: an icon fetch already in flight is not doubled, but is tried again if it fails") { c in
        let board = app("board", icon: "https://deck.mattstack/api/apps/board/icon")
        let plan = CatalogRefresh.iconPlan(apps: [board], deck: deckIcon, loaded: [], inFlight: ["board", "deck"])
        c.expectEqual(plan.fetchNow, [])
        c.expectEqual(plan.afterInFlight, [IconTarget(name: "board", url: "https://deck.mattstack/api/apps/board/icon"),
                                           deckIcon])
    },
    Check("catalog refresh: a stale catalog is fetched again whatever answers") { c in
        c.expect(CatalogRefresh.needsRefetch(fresh: false, apps: [app("board")], settledPid: nil, currentPid: nil))
        c.expect(CatalogRefresh.needsRefetch(fresh: false, apps: [], settledPid: "1", currentPid: "1"))
    },
    Check("catalog refresh: a fresh empty catalog is fetched again while deck answers") { c in
        c.expect(CatalogRefresh.needsRefetch(fresh: true, apps: [], settledPid: "1", currentPid: "1"))
    },
    Check("catalog refresh: a new deck pid invalidates a fresh catalog") { c in
        c.expect(CatalogRefresh.needsRefetch(fresh: true, apps: [app("board")], settledPid: "1", currentPid: "2"))
    },
    Check("catalog refresh: a fresh catalog not yet confirmed by its deck is fetched again") { c in
        c.expect(CatalogRefresh.needsRefetch(fresh: true, apps: [app("board")], settledPid: nil, currentPid: "1"))
    },
    Check("catalog refresh: a settled catalog is kept while its deck answers, and while no deck does") { c in
        c.expect(!CatalogRefresh.needsRefetch(fresh: true, apps: [app("board")], settledPid: "1", currentPid: "1"))
        c.expect(!CatalogRefresh.needsRefetch(fresh: true, apps: [app("board")], settledPid: "1", currentPid: nil))
        c.expect(!CatalogRefresh.needsRefetch(fresh: true, apps: [app("board")], settledPid: nil, currentPid: nil))
    },
    Check("catalog refresh: the first fresh list replaces the cache copy but is not settled yet") { c in
        let take = CatalogRefresh.take(shown: [app("board")], shownFresh: false, shownPid: nil,
                                       fetched: [app("board")], fetchedPid: "1")
        c.expectEqual(take, CatalogTake(apply: true, settledPid: nil))
    },
    Check("catalog refresh: a second identical list from the same deck settles it") { c in
        let take = CatalogRefresh.take(shown: [app("board"), app("chat")], shownFresh: true, shownPid: "1",
                                       fetched: [app("board"), app("chat")], fetchedPid: "1")
        c.expectEqual(take, CatalogTake(apply: false, settledPid: "1"))
    },
    Check("catalog refresh: a list that grew under the same deck is applied and not settled") { c in
        let take = CatalogRefresh.take(shown: [app("board")], shownFresh: true, shownPid: "1",
                                       fetched: [app("board"), app("chat")], fetchedPid: "1")
        c.expectEqual(take, CatalogTake(apply: true, settledPid: nil))
    },
    Check("catalog refresh: another deck's list replaces the tabs") { c in
        let take = CatalogRefresh.take(shown: [app("board"), app("gitq")], shownFresh: true, shownPid: "dev",
                                       fetched: [app("board")], fetchedPid: "prod")
        c.expectEqual(take, CatalogTake(apply: true, settledPid: nil))
    },
    Check("catalog refresh: a changed icon URL is applied") { c in
        let take = CatalogRefresh.take(shown: [app("board")], shownFresh: true, shownPid: "1",
                                       fetched: [app("board", icon: "https://deck.mattstack/api/apps/board/icon")],
                                       fetchedPid: "1")
        c.expectEqual(take.apply, true)
    },
    Check("catalog refresh: an identical list from a deck of unknown pid never settles") { c in
        let take = CatalogRefresh.take(shown: [app("board")], shownFresh: true, shownPid: nil,
                                       fetched: [app("board")], fetchedPid: nil)
        c.expectEqual(take, CatalogTake(apply: false, settledPid: nil))
    },
    Check("catalog refresh: an empty list never settles") { c in
        let take = CatalogRefresh.take(shown: [], shownFresh: true, shownPid: "1", fetched: [], fetchedPid: "1")
        c.expectEqual(take, CatalogTake(apply: false, settledPid: nil))
    },
]
