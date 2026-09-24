import Foundation

/// Reads back what the startup probe wrote by hand: the tray socket is spoken
/// to with raw sockets there, so there is no URLSession to parse the answer.
public enum HTTPReply {
    public static func parse(_ response: String) -> (status: Int, body: String)? {
        let head = response.components(separatedBy: "\r\n").first ?? ""
        let fields = head.components(separatedBy: " ")
        guard fields.count >= 2, fields[0].hasPrefix("HTTP/"), let status = Int(fields[1]) else { return nil }
        let body = response.range(of: "\r\n\r\n").map { String(response[$0.upperBound...]) } ?? ""
        return (status, body.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    public static func succeeded(_ response: String) -> Bool {
        guard let status = parse(response)?.status else { return false }
        return (200..<300).contains(status)
    }
}

/// The tray's own `/health` identity and the reading of someone else's.
public enum TrayHealth {
    public static func body(isDevBuild: Bool) -> String {
        "{\"ok\":true,\"app\":\"mattstack\",\"flavor\":\"\(FlavorIdentity.flavorName(isDevBuild: isDevBuild))\"}"
    }

    /// Takes the raw bytes off the socket, headers and all. An answer without
    /// a usable `flavor` reads as nil: a tray built before the field existed
    /// is unknown, never a mismatch.
    public static func flavor(inResponse response: String) -> String? {
        let body = HTTPReply.parse(response)?.body ?? response
        guard let data = body.trimmingCharacters(in: .whitespacesAndNewlines).data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let flavor = obj["flavor"] as? String,
              flavor == "dev" || flavor == "prod"
        else { return nil }
        return flavor
    }
}

/// Who gets `tray.sock` once a launch has decided to serve. Evicting a live
/// tray of the other flavor is licensed only by this launch taking the Mac
/// over; anything else stands aside.
public enum SocketOwnership {
    public enum Verdict: Equatable, Sendable {
        case takeOver
        case standAside
        case evictThenTakeOver
    }

    public static func decide(myFlavor: String, holderIsLive: Bool, holderFlavor: String?,
                              takingOver: Bool) -> Verdict {
        guard holderIsLive else { return .takeOver }
        guard let holderFlavor, holderFlavor != myFlavor else { return .standAside }
        return takingOver ? .evictThenTakeOver : .standAside
    }
}

/// The two bundles differ only by the dev suffix build.sh templates in
/// (`com.mattstack.app` / `com.mattstack.app.dev`), which is what lets a tray
/// name its sibling without a second hard-coded identifier to keep in sync.
public enum FlavorIdentity {
    public static let devSuffix = ".dev"

    public static func flavorName(isDevBuild: Bool) -> String { isDevBuild ? "dev" : "prod" }

    public static func sibling(ofBundleID id: String) -> String {
        id.hasSuffix(devSuffix) ? String(id.dropLast(devSuffix.count)) : id + devSuffix
    }

    public static func bundleName(ofFlavor flavor: String) -> String {
        flavor == "dev" ? "mattstack-dev.app" : "mattstack.app"
    }
}

/// Every string the flavor paths show a human. Which app is going away and
/// which one keeps the Mac are different facts, so both appear.
public enum FlavorStandDownCopy {
    public static let quitButton = "Quit"

    public static func notificationTitle(myFlavor: String) -> String {
        "mattstack (\(myFlavor)) stood down"
    }

    public static func notificationBody(myFlavor: String, other: String) -> String {
        "The \(other) app is running, so it keeps the daemon and the login item. "
            + "Open \(FlavorIdentity.bundleName(ofFlavor: myFlavor)) to switch this Mac to it."
    }

    public static func retiredBody(myFlavor: String, owner: String) -> String {
        "This Mac was switched to the \(owner) app, so this app gave up its daemon and login item. "
            + "Open \(FlavorIdentity.bundleName(ofFlavor: myFlavor)) to switch back."
    }

    public static func askTitle(other: String) -> String {
        "The \(other) app is running"
    }

    public static func askBody(myFlavor: String, other: String) -> String {
        "Switching hands the daemon, the login item and the rt CLI to \(myFlavor) and quits the \(other) app."
    }

    public static func switchButton(myFlavor: String) -> String {
        "Switch to \(myFlavor) here"
    }

    public static let takeoverFailedTitle = "The switch didn't finish"

    public static let devTakeoverUnavailable =
        "mattstack-dev.app can't find its rt checkout, so it can't switch this Mac to dev. "
            + "From your rt checkout, run: bun run cli.ts flavor takeover dev"

    public static func stuckHolderTitle(holderFlavor: String) -> String {
        "A \(holderFlavor) mattstack is still holding the tray socket"
    }

    public static func stuckHolderBody(holderFlavor: String, myFlavor: String) -> String {
        "The \(holderFlavor) app was asked to retire and did not quit, so the \(myFlavor) app stopped instead of fighting it for the socket. "
            + "Quit the \(holderFlavor) app from its menu bar, or log out and back in."
    }
}

/// Settings' way to switch: open the other app, which takes the Mac over by
/// itself because it was opened by hand.
public enum FlavorSwitchCopy {
    public static func buttonTitle(isDevBuild: Bool) -> String {
        isDevBuild ? "Switch to mattstack.app" : "Switch to the dev app"
    }

    public static func caption(isDevBuild: Bool) -> String {
        isDevBuild
            ? "This is the dev app (mattstack-dev.app), running rt from source."
            : "This is the installed app (mattstack.app)."
    }

    public static func confirmTitle(isDevBuild: Bool) -> String {
        "Open \(FlavorIdentity.bundleName(ofFlavor: isDevBuild ? "prod" : "dev"))?"
    }

    public static func confirmBody(isDevBuild: Bool) -> String {
        "It takes this Mac over: the daemon, the login item and the rt CLI move to it, and "
            + "\(FlavorIdentity.bundleName(ofFlavor: isDevBuild ? "dev" : "prod")) quits."
    }

    public static func notInstalled(isDevBuild: Bool) -> String {
        "\(FlavorIdentity.bundleName(ofFlavor: isDevBuild ? "prod" : "dev")) isn't installed on this Mac."
    }
}
