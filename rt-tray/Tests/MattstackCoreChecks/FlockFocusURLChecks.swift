import Foundation
import MattstackCore

let flockFocusURLChecks: [Check] = [
    Check("the focus URL names the verb and the pane") { c in
        let url = FlockFocusURL.url(paneId: "w1:p2", scheme: "flock")
        c.expectEqual(url?.absoluteString, "flock://focus?pane=w1:p2")
    },
    // A pane id is herdr's, not ours. A character that means something in a
    // query has to survive the trip rather than split the value.
    Check("a pane id carrying a query separator is encoded") { c in
        let url = FlockFocusURL.url(paneId: "w1:p2&pane=w9:p9", scheme: "flock")
        c.expectEqual(url?.absoluteString, "flock://focus?pane=w1:p2%26pane%3Dw9:p9")
    },
    Check("an empty pane id makes no URL") { c in
        c.expect(FlockFocusURL.url(paneId: "", scheme: "flock") == nil, "empty id must not build a URL")
    },
    Check("a running prod flock picks the prod scheme") { c in
        c.expectEqual(FlockFocusURL.scheme(forRunningBundleIDs: ["dev.mattstack.Flock"]), "flock")
    },
    Check("a running dev flock picks the dev scheme") { c in
        c.expectEqual(FlockFocusURL.scheme(forRunningBundleIDs: ["dev.mattstack.Flock.dev"]), "flock-dev")
    },
    // Two installed copies both register a scheme, so the tray has to choose
    // rather than let macOS pick a handler for it.
    Check("both running prefers prod") { c in
        let running: Set<String> = ["dev.mattstack.Flock.dev", "dev.mattstack.Flock"]
        c.expectEqual(FlockFocusURL.scheme(forRunningBundleIDs: running), "flock")
    },
    Check("no flock running picks no scheme") { c in
        c.expect(FlockFocusURL.scheme(forRunningBundleIDs: ["com.mitchellh.ghostty"]) == nil,
                 "a machine with no flock must fall back, not build a URL")
    },
]
