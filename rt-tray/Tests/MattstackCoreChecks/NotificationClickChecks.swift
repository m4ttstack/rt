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
    Check("a malformed URL falls through to pane focus on banner click") { c in
        let r = NotificationClick.bannerRoute(category: "gate", url: "https://[", paneId: "pane-7")
        c.expectEqual(r, .focusPane("pane-7"))
    },
    Check("a malformed URL with no pane routes nowhere") { c in
        c.expectEqual(NotificationClick.focusPaneRoute(url: "https://[", paneId: nil), .none)
    },
    Check("gate_pane banner click prefers the pane over the URL") { c in
        let r = NotificationClick.bannerRoute(
            category: NotificationClick.gatePaneCategory,
            url: "https://console.mattstack/gates/g1", paneId: "pane-7")
        c.expectEqual(r, .focusPane("pane-7"))
    },
    Check("gate_pane banner click falls back to the URL without a pane") { c in
        let r = NotificationClick.bannerRoute(
            category: NotificationClick.gatePaneCategory,
            url: "https://console.mattstack/gates/g1", paneId: nil)
        c.expectEqual(r, .openURL("https://console.mattstack/gates/g1"))
    },
    Check("open button prefers the URL over the pane") { c in
        let r = NotificationClick.openRoute(
            url: "https://console.mattstack/gates/g1", paneId: "pane-7")
        c.expectEqual(r, .openURL("https://console.mattstack/gates/g1"))
    },
    Check("open button falls back to pane focus on a malformed URL") { c in
        c.expectEqual(NotificationClick.openRoute(url: "https://[", paneId: "pane-7"), .focusPane("pane-7"))
    },
    Check("a non-HTTP scheme never wins the open route") { c in
        c.expectEqual(NotificationClick.openRoute(url: "mailto:a@b.c", paneId: "pane-7"), .focusPane("pane-7"))
        c.expectEqual(NotificationClick.openRoute(url: "x-scheme://payload", paneId: nil), .none)
    },
    Check("a non-HTTP scheme never wins the focus-pane fallback either") { c in
        c.expectEqual(NotificationClick.focusPaneRoute(url: "mailto:a@b.c", paneId: nil), .none)
    },
    Check("HTTP survives the scheme guard case-insensitively") { c in
        c.expectEqual(NotificationClick.openRoute(url: "HTTP://x.test/a", paneId: nil), .openURL("HTTP://x.test/a"))
    },
    Check("pane and no-op routes suppress the activation window pop; window-bound routes do not") { c in
        c.expect(NotificationClick.Route.focusPane("p").suppressesActivationShow)
        c.expect(NotificationClick.Route.none.suppressesActivationShow)
        c.expect(!NotificationClick.Route.openURL("https://x.test").suppressesActivationShow)
        c.expect(!NotificationClick.Route.showProcessPanel.suppressesActivationShow)
        c.expect(!NotificationClick.Route.showKeyboardConflict.suppressesActivationShow)
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
