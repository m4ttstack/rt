import Foundation

/// What a launching tray does about the other flavor. Nothing on disk says
/// which app a Mac runs: opening an app by hand takes the Mac over, and a
/// login-item launch never does.
public enum FlavorLaunch {
    public enum SocketVerdict: Equatable, Sendable {
        case claim
        /// Another instance of this app, or a tray too old to name its
        /// flavor: never fought over.
        case exitDoubleLaunch
        /// Decided once the launch origin is known, which is only inside
        /// `applicationDidFinishLaunching`.
        case otherFlavorHolds(String)
    }

    /// Read before anything binds or registers, from the live holder of
    /// `tray.sock` (a leaked socket file answers nothing and is not live).
    public static func socket(myFlavor: String, holderIsLive: Bool, holderFlavor: String?) -> SocketVerdict {
        guard holderIsLive else { return .claim }
        guard let holderFlavor, holderFlavor != myFlavor else { return .exitDoubleLaunch }
        return .otherFlavorHolds(holderFlavor)
    }

    public enum Plan: Equatable, Sendable {
        case serve
        case takeOver
        /// A login item while the other app's tray runs.
        case standDown(other: String)
        /// A login item on a Mac whose ~/.local/bin/rt the other app took:
        /// a switch made while this app was not running left its login item
        /// and agents registered, and only this app can unregister them.
        case retire(owner: String)
        case ask(other: String)
    }

    /// `rtOwner` is `RtLinkOwner.flavor` of ~/.local/bin/rt; nil (foreign,
    /// ambiguous, missing) never retires anything. `unknown` never takes the
    /// Mac on a guess, and never retires this app on one either.
    public static func plan(myFlavor: String, origin: LaunchOrigin, otherTrayAlive: String?, rtOwner: String?) -> Plan {
        switch origin {
        case .userLaunch:
            return .takeOver
        case .loginItem:
            if let otherTrayAlive { return .standDown(other: otherTrayAlive) }
            if let rtOwner, rtOwner != myFlavor { return .retire(owner: rtOwner) }
            return .serve
        case .unknown:
            return otherTrayAlive.map { .ask(other: $0) } ?? .serve
        }
    }

    public static func takeoverArguments(myFlavorIsDev: Bool) -> [String] {
        ["flavor", "takeover", FlavorIdentity.flavorName(isDevBuild: myFlavorIsDev), "--json"]
    }
}

/// Which app a takeover pointed ~/.local/bin/rt at, only when that is
/// unmistakable: the dev takeover writes a script whose second line is the
/// dev-mode marker (lib/dev-mode.ts DEV_MODE_TAG), the prod takeover links
/// an absolute path to a `mattstack.app` bundle's compiled rt. Everything
/// else, a legacy markerless wrapper included, is nobody's.
public enum RtLinkOwner {
    public static let devWrapperTag = "# mattstack-dev-mode"

    /// `linkTarget` is the symlink's destination when the path is a link;
    /// `prefix` is a bounded head of the file when it is not.
    public static func flavor(linkTarget: String?, prefix: String?) -> String? {
        if let linkTarget {
            let suffix = "/" + FlavorIdentity.bundleName(ofFlavor: "prod") + "/Contents/MacOS/rt"
            return linkTarget.hasPrefix("/") && linkTarget.hasSuffix(suffix) ? "prod" : nil
        }
        guard let prefix, prefix.hasPrefix("#!") else { return nil }
        let lines = prefix.split(separator: "\n", maxSplits: 2, omittingEmptySubsequences: false)
        guard lines.count > 1, lines[1].hasPrefix(devWrapperTag) else { return nil }
        return "dev"
    }
}
