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
    Check("plan: opened by hand takes over, whatever else is running or rt points at") { c in
        c.expectEqual(FlavorLaunch.plan(myFlavor: "dev", origin: .userLaunch, otherTrayAlive: nil, rtOwner: nil, ownerInstalled: true), .takeOver)
        c.expectEqual(FlavorLaunch.plan(myFlavor: "dev", origin: .userLaunch, otherTrayAlive: "prod", rtOwner: "prod", ownerInstalled: true), .takeOver)
    },
    Check("plan: login item while the other flavor's tray runs stands down") { c in
        c.expectEqual(FlavorLaunch.plan(myFlavor: "dev", origin: .loginItem, otherTrayAlive: "prod", rtOwner: "dev", ownerInstalled: true),
                      .standDown(other: "prod"))
    },
    Check("plan: login item with rt pointing at the other flavor retires itself") { c in
        c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: .loginItem, otherTrayAlive: nil, rtOwner: "dev", ownerInstalled: true),
                      .retire(owner: "dev"))
        c.expectEqual(FlavorLaunch.plan(myFlavor: "dev", origin: .loginItem, otherTrayAlive: nil, rtOwner: "prod", ownerInstalled: true),
                      .retire(owner: "prod"))
    },
    Check("plan: login item with rt pointing at the other flavor whose app is not installed serves") { c in
        c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: .loginItem, otherTrayAlive: nil, rtOwner: "dev",
                                        ownerInstalled: false), .serve)
    },
    Check("rt owner: a prod link whose target is gone is nobody's") { c in
        c.expect(RtLinkOwner.flavor(linkTarget: "/Applications/mattstack.app/Contents/MacOS/rt", linkTargetExists: false,
                                    prefix: nil) == nil)
    },
    Check("plan: login item with rt pointing at itself serves") { c in
        c.expectEqual(FlavorLaunch.plan(myFlavor: "dev", origin: .loginItem, otherTrayAlive: nil, rtOwner: "dev", ownerInstalled: true), .serve)
    },
    Check("plan: login item with rt foreign or missing serves") { c in
        c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: .loginItem, otherTrayAlive: nil, rtOwner: nil, ownerInstalled: true), .serve)
    },
    Check("plan: an unidentified launch asks when the other app runs, else serves without taking over or retiring") { c in
        c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: .unknown, otherTrayAlive: "dev", rtOwner: nil, ownerInstalled: true), .ask(other: "dev"))
        c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: .unknown, otherTrayAlive: nil, rtOwner: nil, ownerInstalled: true), .serve)
        c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: .unknown, otherTrayAlive: nil, rtOwner: "prod", ownerInstalled: true), .serve)
    },
    Check("plan: a url launch asks when the other app runs; it never takes over or retires") { c in
        c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: .urlLaunch, otherTrayAlive: "dev", rtOwner: "dev", ownerInstalled: true), .ask(other: "dev"))
    },
    Check("plan: a url or unknown launch on a Mac whose rt the installed other app owns hands off to it") { c in
        for origin in [LaunchOrigin.urlLaunch, .unknown] {
            c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: origin, otherTrayAlive: nil, rtOwner: "dev", ownerInstalled: true),
                          .handOff(owner: "dev"))
        }
    },
    Check("plan: a url launch serves when the other app is not installed or rt is its own or nobody's") { c in
        c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: .urlLaunch, otherTrayAlive: nil, rtOwner: "dev", ownerInstalled: false), .serve)
        c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: .urlLaunch, otherTrayAlive: nil, rtOwner: "prod", ownerInstalled: true), .serve)
        c.expectEqual(FlavorLaunch.plan(myFlavor: "prod", origin: .urlLaunch, otherTrayAlive: nil, rtOwner: nil, ownerInstalled: true), .serve)
    },
    Check("rt owner: the marked dev wrapper belongs to dev") { c in
        c.expectEqual(RtLinkOwner.flavor(linkTarget: nil, linkTargetExists: false,
                                         prefix: "#!/bin/zsh\n# mattstack-dev-mode\nexport PATH=x\n"), "dev")
    },
    Check("rt owner: a link to a mattstack.app bundle's compiled rt belongs to prod") { c in
        c.expectEqual(RtLinkOwner.flavor(linkTarget: "/Applications/mattstack.app/Contents/MacOS/rt", linkTargetExists: true, prefix: nil), "prod")
        c.expectEqual(RtLinkOwner.flavor(linkTarget: "/Users/x/Applications/mattstack.app/Contents/MacOS/rt", linkTargetExists: true, prefix: nil), "prod")
    },
    Check("rt owner: anything ambiguous or foreign is nobody's") { c in
        c.expect(RtLinkOwner.flavor(linkTarget: nil, linkTargetExists: false, prefix: nil) == nil, "missing")
        c.expect(RtLinkOwner.flavor(linkTarget: "/opt/homebrew/bin/rt", linkTargetExists: true, prefix: nil) == nil, "a user copy")
        c.expect(RtLinkOwner.flavor(linkTarget: "mattstack.app/Contents/MacOS/rt", linkTargetExists: true, prefix: nil) == nil, "a relative link")
        c.expect(RtLinkOwner.flavor(linkTarget: "/Applications/mattstack-dev.app/Contents/MacOS/rt", linkTargetExists: true, prefix: nil) == nil,
                 "the dev bundle's rt is its daemon shim, never a CLI link")
        c.expect(RtLinkOwner.flavor(linkTarget: "/Applications/not-mattstack.app/Contents/MacOS/rt", linkTargetExists: true, prefix: nil) == nil,
                 "a bundle whose name only ends in mattstack.app")
        c.expect(RtLinkOwner.flavor(linkTarget: nil, linkTargetExists: false,
                                    prefix: "#!/bin/zsh\nexport RT_LAUNCH_CWD=\"$PWD\"\nexec bun run cli.ts\n") == nil,
                 "a markerless legacy wrapper")
        c.expect(RtLinkOwner.flavor(linkTarget: nil, linkTargetExists: false, prefix: "#!/bin/zsh\nexec \"/Users/x/.bun/bin/bun\" run cli.ts\n") == nil,
                 "a standalone rt 2.5.x wrapper")
        c.expect(RtLinkOwner.flavor(linkTarget: nil, linkTargetExists: false, prefix: "\u{cf}\u{fa}\u{ed}\u{fe}binary") == nil, "a copied binary")
        c.expect(RtLinkOwner.flavor(linkTarget: nil, linkTargetExists: false, prefix: "#!/bin/sh\n# mattstack-link rt\nexec x\n") == nil,
                 "a tagged PATH-link wrapper")
    },
    Check("failed takeover: with the other app gone, this app serves and reports; with it still serving, this app quits") { c in
        c.expectEqual(FlavorLaunch.afterFailedTakeover(socketClaimed: true), .serveAndReport)
        c.expectEqual(FlavorLaunch.afterFailedTakeover(socketClaimed: false), .quitAndReport)
    },
    Check("dev source config: the shim's rules (absolute source, bun defaulting to ~/.bun/bin/bun)") { c in
        c.expectEqual(DevSourceConfig.parse(json: #"{"sourcePath":"/src/rt","bunPath":"/opt/bun"}"#, home: "/Users/x"),
                      DevSourceConfig(sourcePath: "/src/rt", bunPath: "/opt/bun"))
        c.expectEqual(DevSourceConfig.parse(json: #"{"sourcePath":"/src/rt","bunPath":"bun"}"#, home: "/Users/x"),
                      DevSourceConfig(sourcePath: "/src/rt", bunPath: "/Users/x/.bun/bin/bun"))
        c.expect(DevSourceConfig.parse(json: #"{"sourcePath":"src/rt"}"#, home: "/Users/x") == nil, "relative source")
        c.expect(DevSourceConfig.parse(json: "not json", home: "/Users/x") == nil)
    },
    Check("dev takeover: the marked dev wrapper runs it") { c in
        let config = DevSourceConfig(sourcePath: "/src/rt", bunPath: "/opt/bun")
        c.expectEqual(FlavorLaunch.devTakeoverRoute(rtOwner: "dev", config: config, fileExists: { _ in true }), .wrapper)
    },
    Check("dev takeover: any other ~/.local/bin/rt runs the stored checkout through bun") { c in
        let config = DevSourceConfig(sourcePath: "/src/rt", bunPath: "/opt/bun")
        let route = FlavorLaunch.devTakeoverRoute(rtOwner: "prod", config: config, fileExists: { _ in true })
        c.expectEqual(route, .source(RtLocation(executable: URL(fileURLWithPath: "/opt/bun"),
                                                argumentPrefix: ["run", "/src/rt/cli.ts"], source: .devSource)))
        c.expectEqual(FlavorLaunch.devTakeoverRoute(rtOwner: nil, config: config, fileExists: { _ in true }), route)
    },
    Check("dev takeover: no usable checkout or bun is unavailable, and the copy names the command to run") { c in
        let config = DevSourceConfig(sourcePath: "/src/rt", bunPath: "/opt/bun")
        c.expectEqual(FlavorLaunch.devTakeoverRoute(rtOwner: nil, config: nil, fileExists: { _ in true }), .unavailable)
        c.expectEqual(FlavorLaunch.devTakeoverRoute(rtOwner: nil, config: config, fileExists: { $0 != "/opt/bun" }), .unavailable)
        c.expectEqual(FlavorLaunch.devTakeoverRoute(rtOwner: nil, config: config, fileExists: { !$0.hasSuffix("cli.ts") }), .unavailable)
        c.expect(FlavorStandDownCopy.devTakeoverUnavailable.contains("bun run cli.ts flavor takeover dev"))
    },
    Check("after a successful takeover: a held socket gets one more eviction, then this app serves over the retired holder") { c in
        c.expectEqual(FlavorLaunch.afterTakeover(socketClaimed: true, evictionRetried: false), .serve)
        c.expectEqual(FlavorLaunch.afterTakeover(socketClaimed: false, evictionRetried: false), .retryEviction)
        c.expectEqual(FlavorLaunch.afterTakeover(socketClaimed: true, evictionRetried: true), .serve)
        c.expectEqual(FlavorLaunch.afterTakeover(socketClaimed: false, evictionRetried: true), .serveOverStuckHolder)
    },
    Check("takeover argv names only my own flavor") { c in
        c.expectEqual(FlavorLaunch.takeoverArguments(myFlavorIsDev: true), ["flavor", "takeover", "dev", "--json"])
        c.expectEqual(FlavorLaunch.takeoverArguments(myFlavorIsDev: false), ["flavor", "takeover", "prod", "--json"])
    },
    Check("locator: dev build with no wrapper resolves nil, never the bundled daemon shim") { c in
        let loc = RtBinaryLocator.resolve(bundlePath: "/tmp/x.app", isDevBuild: true, isDebugBuild: false,
                                          environment: [:], home: "/tmp/nohome",
                                          fileExists: { $0.contains("Contents/MacOS/rt") })
        c.expect(loc == nil, "no dev wrapper ⇒ nil, even though the bundled path exists")
    },
]
