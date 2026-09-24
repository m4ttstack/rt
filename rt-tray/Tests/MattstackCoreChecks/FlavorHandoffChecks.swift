import Foundation
import CoreServices
import MattstackCore

private let healthResponse = """
HTTP/1.1 200 OK\r
Content-Type: application/json\r
Content-Length: 46\r
Connection: close\r
\r
{"ok":true,"app":"mattstack","flavor":"dev"}
"""

let flavorHandoffChecks: [Check] = [
    Check("health body names the flavor") { c in
        c.expectEqual(TrayHealth.body(isDevBuild: true), #"{"ok":true,"app":"mattstack","flavor":"dev"}"#)
        c.expectEqual(TrayHealth.body(isDevBuild: false), #"{"ok":true,"app":"mattstack","flavor":"prod"}"#)
    },
    Check("health flavor is read out of a raw HTTP response") { c in
        c.expectEqual(TrayHealth.flavor(inResponse: healthResponse), "dev")
        c.expectEqual(TrayHealth.flavor(inResponse: TrayHealth.body(isDevBuild: false)), "prod")
    },
    Check("an older tray's health answer reads as unknown, not as a mismatch") { c in
        c.expect(TrayHealth.flavor(inResponse: #"{"ok":true,"app":"mattstack"}"#) == nil)
        c.expect(TrayHealth.flavor(inResponse: "HTTP/1.1 200 OK\r\n\r\nnot json") == nil)
        c.expect(TrayHealth.flavor(inResponse: #"{"ok":true,"flavor":"staging"}"#) == nil)
    },
    Check("a hand-written reply is parsed into status and body") { c in
        let parsed = try c.requireSome(HTTPReply.parse(healthResponse))
        c.expectEqual(parsed.status, 200)
        c.expectEqual(parsed.body, #"{"ok":true,"app":"mattstack","flavor":"dev"}"#)
        c.expect(HTTPReply.succeeded(healthResponse))
    },
    Check("a 404 from a tray without the retire route is not a success") { c in
        let notFound = "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n{\"ok\":false}"
        c.expectEqual(HTTPReply.parse(notFound)?.status, 404)
        c.expect(!HTTPReply.succeeded(notFound))
        c.expect(!HTTPReply.succeeded("garbage"))
        c.expect(HTTPReply.parse("garbage") == nil)
    },
    Check("socket ownership: a dead holder is taken over") { c in
        c.expectEqual(SocketOwnership.decide(myFlavor: "dev", holderIsLive: false, holderFlavor: nil,
                                             takingOver: true), .takeOver)
    },
    Check("socket ownership: a same-flavor holder keeps the socket") { c in
        c.expectEqual(SocketOwnership.decide(myFlavor: "dev", holderIsLive: true, holderFlavor: "dev",
                                             takingOver: true), .standAside)
    },
    Check("socket ownership: an unidentifiable holder keeps the socket") { c in
        c.expectEqual(SocketOwnership.decide(myFlavor: "prod", holderIsLive: true, holderFlavor: nil,
                                             takingOver: true), .standAside)
    },
    Check("socket ownership: a wrong-flavor holder is evicted by a takeover") { c in
        c.expectEqual(SocketOwnership.decide(myFlavor: "prod", holderIsLive: true, holderFlavor: "dev",
                                             takingOver: true), .evictThenTakeOver)
    },
    Check("socket ownership: a launch that is not taking over never evicts anyone") { c in
        c.expectEqual(SocketOwnership.decide(myFlavor: "prod", holderIsLive: true, holderFlavor: "dev",
                                             takingOver: false), .standAside)
    },
    Check("sibling bundle id round-trips between the flavors") { c in
        c.expectEqual(FlavorIdentity.sibling(ofBundleID: "com.mattstack.app"), "com.mattstack.app.dev")
        c.expectEqual(FlavorIdentity.sibling(ofBundleID: "com.mattstack.app.dev"), "com.mattstack.app")
        c.expectEqual(FlavorIdentity.bundleName(ofFlavor: "dev"), "mattstack-dev.app")
        c.expectEqual(FlavorIdentity.bundleName(ofFlavor: "prod"), "mattstack.app")
    },
    Check("launch kind: only the login-item Apple Event is a login item") { c in
        let loginItem = LaunchKind.classify(eventID: UInt32(kAEOpenApplication), propData: UInt32(keyAELaunchedAsLogInItem),
                                            isDefaultLaunch: true)
        c.expectEqual(loginItem, .loginItem)
    },
    Check("launch kind: a plain default open is a user launch; no event at all is unknown") { c in
        c.expectEqual(LaunchKind.classify(eventID: UInt32(kAEOpenApplication), propData: nil, isDefaultLaunch: true), .userLaunch)
        c.expectEqual(LaunchKind.classify(eventID: UInt32(kAEOpenApplication), propData: nil, isDefaultLaunch: nil), .userLaunch)
        c.expectEqual(LaunchKind.classify(eventID: nil, propData: nil, isDefaultLaunch: nil), .unknown)
    },
    Check("launch kind: a launch to open a link or document is a url launch, never a user launch") { c in
        c.expectEqual(LaunchKind.classify(eventID: 0x4755_524C /* 'GURL' */, propData: nil, isDefaultLaunch: nil), .urlLaunch)
        c.expectEqual(LaunchKind.classify(eventID: UInt32(kAEOpenDocuments), propData: nil, isDefaultLaunch: nil), .urlLaunch)
        c.expectEqual(LaunchKind.classify(eventID: UInt32(kAEOpenApplication), propData: nil, isDefaultLaunch: false), .urlLaunch)
    },
    Check("a stuck holder is named to the user with a remedy") { c in
        let body = FlavorStandDownCopy.stuckHolderBody(holderFlavor: "dev", myFlavor: "prod")
        c.expect(FlavorStandDownCopy.stuckHolderTitle(holderFlavor: "dev").contains("dev"))
        c.expect(body.contains("dev") && body.contains("prod"))
        c.expect(body.contains("log out"), "the remedy has to be in the body, not just the log")
    },
    Check("stand-down copy names the app keeping the Mac and the way back, never a mode") { c in
        let body = FlavorStandDownCopy.notificationBody(myFlavor: "prod", other: "dev")
        let retired = FlavorStandDownCopy.retiredBody(myFlavor: "prod", owner: "dev")
        c.expect(retired.contains("dev app"), retired)
        c.expect(retired.contains("Open mattstack.app"), retired)
        c.expect(!retired.contains("mode"), retired)
        c.expect(FlavorStandDownCopy.notificationTitle(myFlavor: "prod").contains("prod"))
        c.expect(body.contains("dev app is running"))
        c.expect(body.contains("Open mattstack.app"))
        c.expectEqual(FlavorStandDownCopy.askTitle(other: "dev"), "The dev app is running")
        c.expect(FlavorStandDownCopy.askBody(myFlavor: "prod", other: "dev").contains("quits the dev app"))
        c.expectEqual(FlavorStandDownCopy.switchButton(myFlavor: "prod"), "Switch to prod here")
        for text in [body, FlavorStandDownCopy.askBody(myFlavor: "prod", other: "dev")] {
            c.expect(!text.contains("mode"), "no intended mode exists any more: \(text)")
        }
    },
    Check("settings switch copy names the other app to open") { c in
        c.expectEqual(FlavorSwitchCopy.buttonTitle(isDevBuild: false), "Switch to the dev app")
        c.expectEqual(FlavorSwitchCopy.buttonTitle(isDevBuild: true), "Switch to mattstack.app")
        c.expectEqual(FlavorSwitchCopy.confirmTitle(isDevBuild: false), "Open mattstack-dev.app?")
        c.expect(FlavorSwitchCopy.confirmBody(isDevBuild: false).contains("mattstack.app quits"))
        c.expect(FlavorSwitchCopy.notInstalled(isDevBuild: true).contains("mattstack.app"))
    },
]
