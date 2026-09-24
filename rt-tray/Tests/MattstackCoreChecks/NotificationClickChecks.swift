import Foundation
@testable import MattstackCore

let notificationClickChecks: [Check] = [
    Check("member_joined banner click asks to confirm the members sync for that team and handle") { c in
        let r = NotificationClick.bannerRoute(category: NotificationClick.memberJoinedCategory, url: nil, paneId: nil, team: "acme", handle: "ed")
        c.expectEqual(r, .confirmMembersSync(team: "acme", handle: "ed"))
        c.expect(r.suppressesActivationShow, "an alert must not drag the shell window up first")
    },
    Check("member_joined with a team that is not a slug routes nowhere: the tray socket is unauthenticated") { c in
        c.expectEqual(NotificationClick.memberJoinedRoute(team: "../etc", handle: "ed"), .none)
        c.expectEqual(NotificationClick.memberJoinedRoute(team: "Acme Corp", handle: "ed"), .none)
        c.expectEqual(NotificationClick.memberJoinedRoute(team: "", handle: "ed"), .none)
        c.expectEqual(NotificationClick.memberJoinedRoute(team: nil, handle: "ed"), .none)
        c.expectEqual(NotificationClick.memberJoinedRoute(team: "acme", handle: ""), .none)
    },
    Check("member_joined with a handle that is not a handle routes nowhere too") { c in
        c.expectEqual(NotificationClick.memberJoinedRoute(team: "acme", handle: "ed smith"), .none)
        c.expectEqual(NotificationClick.memberJoinedRoute(team: "acme", handle: "-ed"), .none)
        c.expectEqual(NotificationClick.memberJoinedRoute(team: "acme", handle: String(repeating: "e", count: 40)), .none)
        c.expectEqual(NotificationClick.memberJoinedRoute(team: "acme", handle: "Ed.Smith-2"), .confirmMembersSync(team: "acme", handle: "Ed.Smith-2"))
    },
    Check("member_joined copy names the handle and team, and says the sync adds everyone who replied") { c in
        let copy = NotificationClick.membersSyncAlertCopy(team: "acme", handle: "ed")
        c.expectEqual(copy.title, "Add ed to acme?")
        c.expect(copy.body.contains("rt team members sync"), "body names the verb")
        c.expect(copy.body.contains("everyone who has replied"), "body says the sync is team-wide")
        c.expect(copy.body.contains("re-encrypt"), "body says secrets are re-encrypted")
        c.expectEqual(copy.confirm, "Add member")
    },
    Check("members sync outcome matches the named handle against addedHandles, never the key list or the exit code") { c in
        let added = Data("{\"contract\":1,\"added\":[\"age1owner\",\"age1ed\"],\"addedHandles\":[\"ed\"],\"pending\":[],\"reencrypted\":[\"board.json\"]}".utf8)
        c.expectEqual(MembersSyncOutcome.parse(stdout: added, handle: "ed"), .added)
        let pending = Data("{\"added\":[\"age1owner\"],\"addedHandles\":[],\"pending\":[\"ed\"],\"reencrypted\":[]}".utf8)
        c.expectEqual(MembersSyncOutcome.parse(stdout: pending, handle: "ed"), .pending)
        let someoneElse = Data("{\"added\":[\"age1jo\"],\"addedHandles\":[\"jo\"],\"pending\":[],\"reencrypted\":[]}".utf8)
        c.expectEqual(MembersSyncOutcome.parse(stdout: someoneElse, handle: "ed"), .notFound)
        let ownerOnly = Data("{\"added\":[\"age1owner\"],\"addedHandles\":[],\"pending\":[],\"reencrypted\":[]}".utf8)
        c.expectEqual(MembersSyncOutcome.parse(stdout: ownerOnly, handle: "ed"), .notFound)
        c.expectEqual(MembersSyncOutcome.parse(stdout: Data("{\"added\":[],\"pending\":[]}".utf8), handle: "ed"), .unknown)
        c.expectEqual(MembersSyncOutcome.parse(stdout: Data("not json".utf8), handle: "ed"), .unknown)
    },
    Check("a plain banner click ignores team and handle") { c in
        let r = NotificationClick.bannerRoute(category: "gate", url: nil, paneId: "pane-7", team: "acme", handle: "ed")
        c.expectEqual(r, .focusPane("pane-7"))
    },
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
