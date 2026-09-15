import Foundation
@testable import MattstackCore

let openLinkChecks: [Check] = [
    Check("mattstack://open/<app>/<path>?q parses") { c in
        let r = OpenLink.request(from: URL(string: "mattstack://open/board/mr/123?tab=ci")!)
        try c.requireEqual(r, OpenRequest(app: "board", pathAndQuery: "/mr/123?tab=ci"))
    },
    Check("mattstack://open/<app> parses with empty path") { c in
        let r = OpenLink.request(from: URL(string: "mattstack://open/chat")!)
        try c.requireEqual(r, OpenRequest(app: "chat", pathAndQuery: ""))
    },
    Check("mattstack://join is not an open link") { c in
        c.expect(OpenLink.request(from: URL(string: "mattstack://join/ABC")!) == nil)
    },
    Check("mattstack://open with no app is rejected") { c in
        c.expect(OpenLink.request(from: URL(string: "mattstack://open")!) == nil)
    },
    Check("https://<app>.mattstack/<path> parses") { c in
        let r = OpenLink.request(fromHTTPS: URL(string: "https://console.mattstack/runs/9?x=1")!)
        try c.requireEqual(r, OpenRequest(app: "console", pathAndQuery: "/runs/9?x=1"))
    },
    Check("https root path parses to empty pathAndQuery") { c in
        let r = OpenLink.request(fromHTTPS: URL(string: "https://chat.mattstack/")!)
        try c.requireEqual(r, OpenRequest(app: "chat", pathAndQuery: ""))
    },
    Check("non-mattstack https host is rejected") { c in
        c.expect(OpenLink.request(fromHTTPS: URL(string: "https://example.com/a")!) == nil)
        c.expect(OpenLink.request(fromHTTPS: URL(string: "https://a.b.mattstack/")!) == nil)
    },
    Check("destination joins app url and path") { c in
        let apps = [DiscoveryApp(name: "board", displayName: "Board", description: nil,
                                 url: "https://board.mattstack", icon: nil)]
        let dest = WindowNavigation.destination(for: OpenRequest(app: "board", pathAndQuery: "/mr/1"), in: apps)
        try c.requireEqual(dest, URL(string: "https://board.mattstack/mr/1"))
        c.expect(WindowNavigation.destination(for: OpenRequest(app: "nope", pathAndQuery: ""), in: apps) == nil)
    },
]
