import Foundation
import MattstackCore

let flavorLaunchChecks: [Check] = [
    Check("socket: nothing live on the socket is claimed") { c in
        c.expectEqual(FlavorLaunch.socket(myFlavor: "dev", holderIsLive: false, holderFlavor: nil), .claim)
        c.expectEqual(FlavorLaunch.socket(myFlavor: "dev", holderIsLive: false, holderFlavor: "prod"), .claim)
    },
    Check("socket: a live tray of my own flavor is a double launch") { c in
        c.expectEqual(FlavorLaunch.socket(myFlavor: "dev", holderIsLive: true, holderFlavor: "dev"), .exitDoubleLaunch)
    },
    Check("socket: an unidentifiable live holder is never fought") { c in
        c.expectEqual(FlavorLaunch.socket(myFlavor: "prod", holderIsLive: true, holderFlavor: nil), .exitDoubleLaunch)
    },
    Check("socket: the other flavor's live tray defers to the launch origin") { c in
        c.expectEqual(FlavorLaunch.socket(myFlavor: "prod", holderIsLive: true, holderFlavor: "dev"),
                      .otherFlavorHolds("dev"))
    },
    Check("plan: opened by hand takes over, whatever else is running") { c in
        c.expectEqual(FlavorLaunch.plan(origin: .userLaunch, otherTrayAlive: nil), .takeOver)
        c.expectEqual(FlavorLaunch.plan(origin: .userLaunch, otherTrayAlive: "prod"), .takeOver)
    },
    Check("plan: a login item never takes over; it stands down while the other app runs") { c in
        c.expectEqual(FlavorLaunch.plan(origin: .loginItem, otherTrayAlive: "prod"), .standDown(other: "prod"))
        c.expectEqual(FlavorLaunch.plan(origin: .loginItem, otherTrayAlive: nil), .serve)
    },
    Check("plan: an unidentified launch asks when the other app runs, else serves without taking over") { c in
        c.expectEqual(FlavorLaunch.plan(origin: .unknown, otherTrayAlive: "dev"), .ask(other: "dev"))
        c.expectEqual(FlavorLaunch.plan(origin: .unknown, otherTrayAlive: nil), .serve)
    },
    Check("takeover argv names only my own flavor") { c in
        c.expectEqual(FlavorLaunch.takeoverArguments(myFlavorIsDev: true), ["flavor", "takeover", "dev", "--json"])
        c.expectEqual(FlavorLaunch.takeoverArguments(myFlavorIsDev: false), ["flavor", "takeover", "prod", "--json"])
    },
    Check("locator: dev build with no wrapper resolves nil — never the bundled daemon shim") { c in
        let loc = RtBinaryLocator.resolve(bundlePath: "/tmp/x.app", isDevBuild: true, isDebugBuild: false,
                                          environment: [:], home: "/tmp/nohome",
                                          fileExists: { $0.contains("Contents/MacOS/rt") })
        c.expect(loc == nil, "no dev wrapper ⇒ nil, even though the bundled path exists")
    },
]
