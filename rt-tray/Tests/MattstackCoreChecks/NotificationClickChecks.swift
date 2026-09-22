import Foundation
@testable import MattstackCore

let notificationClickChecks: [Check] = [
    Check("banner click prefers the surface URL over pane focus") { c in
        let r = NotificationClick.bannerRoute(
            category: "gate", url: "https://board.mattstack/?gate=g1", paneId: "pane-7")
        c.expectEqual(r, .openURL("https://board.mattstack/?gate=g1"))
    },
    Check("banner click falls back to pane focus without a URL") { c in
        let r = NotificationClick.bannerRoute(category: "gate", url: nil, paneId: "pane-7")
        c.expectEqual(r, .focusPane("pane-7"))
    },
    Check("banner click with neither URL nor pane routes nowhere") { c in
        let r = NotificationClick.bannerRoute(category: "stale_port", url: nil, paneId: nil)
        c.expectEqual(r, .none)
    },
    Check("empty strings count as absent") { c in
        let r = NotificationClick.bannerRoute(category: "gate", url: "", paneId: "")
        c.expectEqual(r, .none)
    },
    Check("keyboard_conflict banner click wins over URL and pane") { c in
        let r = NotificationClick.bannerRoute(
            category: "keyboard_conflict", url: "https://x.mattstack/", paneId: "p")
        c.expectEqual(r, .showKeyboardConflict)
    },
    Check("ready_held banner click opens the process panel") { c in
        let r = NotificationClick.bannerRoute(
            category: NotificationClick.readyHeldCategory, url: nil, paneId: nil)
        c.expectEqual(r, .showProcessPanel)
    },
    Check("focus-pane button prefers the pane over the URL") { c in
        let r = NotificationClick.focusPaneRoute(
            url: "https://board.mattstack/?gate=g1", paneId: "pane-7")
        c.expectEqual(r, .focusPane("pane-7"))
    },
    Check("focus-pane button falls back to the URL without a pane") { c in
        let r = NotificationClick.focusPaneRoute(url: "https://board.mattstack/?gate=g1", paneId: nil)
        c.expectEqual(r, .openURL("https://board.mattstack/?gate=g1"))
    },
    Check("focus-pane button with neither routes nowhere") { c in
        c.expectEqual(NotificationClick.focusPaneRoute(url: "", paneId: nil), .none)
    },
]
