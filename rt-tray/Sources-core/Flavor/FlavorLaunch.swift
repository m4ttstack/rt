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
        case standDown(other: String)
        case ask(other: String)
    }

    /// `unknown` never takes the Mac on a guess, and never retires this app
    /// on one either: while the other app runs, the user decides.
    public static func plan(origin: LaunchOrigin, otherTrayAlive: String?) -> Plan {
        switch origin {
        case .userLaunch:
            return .takeOver
        case .loginItem:
            return otherTrayAlive.map { .standDown(other: $0) } ?? .serve
        case .unknown:
            return otherTrayAlive.map { .ask(other: $0) } ?? .serve
        }
    }

    public static func takeoverArguments(myFlavorIsDev: Bool) -> [String] {
        ["flavor", "takeover", FlavorIdentity.flavorName(isDevBuild: myFlavorIsDev), "--json"]
    }
}
