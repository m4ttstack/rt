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
        /// A link or unidentified launch on a Mac the installed other app
        /// owns (its ~/.local/bin/rt) while its tray is not running: the
        /// link goes to that app and this one quits, registering nothing.
        case handOff(owner: String)
    }

    /// `rtOwner` is `RtLinkOwner.flavor` of ~/.local/bin/rt; nil (foreign,
    /// ambiguous, missing) never retires anything, and neither does an owner
    /// whose app is not installed: retiring for it would leave no app at
    /// login. A url or unknown launch never takes the Mac on a guess, and
    /// never retires this app on one either.
    public static func plan(myFlavor: String, origin: LaunchOrigin, otherTrayAlive: String?, rtOwner: String?,
                            ownerInstalled: Bool) -> Plan {
        switch origin {
        case .userLaunch:
            return .takeOver
        case .loginItem:
            if let otherTrayAlive { return .standDown(other: otherTrayAlive) }
            if let rtOwner, rtOwner != myFlavor, ownerInstalled { return .retire(owner: rtOwner) }
            return .serve
        case .urlLaunch, .unknown:
            if let otherTrayAlive { return .ask(other: otherTrayAlive) }
            if let rtOwner, rtOwner != myFlavor, ownerInstalled { return .handOff(owner: rtOwner) }
            return .serve
        }
    }

    public enum FailedTakeover: Equatable, Sendable {
        case serveAndReport
        case quitAndReport
    }

    /// A takeover that failed may already have retired the other app. If the
    /// socket is free this app is all the Mac has left, so it serves; only
    /// while the other app still holds the Mac does quitting leave it served.
    public static func afterFailedTakeover(socketClaimed: Bool) -> FailedTakeover {
        socketClaimed ? .serveAndReport : .quitAndReport
    }

    public enum DevTakeoverRoute: Equatable, Sendable {
        /// ~/.local/bin/rt is the marked dev wrapper: run it as usual.
        case wrapper
        /// Anything else there (a foreign rt, an older prod binary, nothing)
        /// may not know the verb, so the stored checkout runs it directly.
        case source(RtLocation)
        case unavailable
    }

    public static func devTakeoverRoute(rtOwner: String?, config: DevSourceConfig?,
                                        fileExists: (String) -> Bool) -> DevTakeoverRoute {
        if rtOwner == "dev" { return .wrapper }
        guard let config else { return .unavailable }
        let cli = config.sourcePath + "/cli.ts"
        guard fileExists(cli), fileExists(config.bunPath) else { return .unavailable }
        return .source(RtLocation(executable: URL(fileURLWithPath: config.bunPath),
                                  argumentPrefix: ["run", cli], source: .devSource))
    }

    public static func takeoverArguments(myFlavorIsDev: Bool) -> [String] {
        ["flavor", "takeover", FlavorIdentity.flavorName(isDevBuild: myFlavorIsDev), "--json"]
    }
}

/// The dev app's checkout, from the state.db kv row ns='dev-mode',
/// k='config' (or the legacy dev-mode.json), validated exactly the way
/// rt-tray/Sources-daemon-shim/main.swift `finalizeConfig` validates it.
public struct DevSourceConfig: Equatable, Sendable {
    public let sourcePath: String
    public let bunPath: String
    public init(sourcePath: String, bunPath: String) { self.sourcePath = sourcePath; self.bunPath = bunPath }

    public static func parse(json: String, home: String) -> DevSourceConfig? {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let source = obj["sourcePath"] as? String, source.hasPrefix("/")
        else { return nil }
        let bun = (obj["bunPath"] as? String).flatMap { $0.hasPrefix("/") ? $0 : nil } ?? "\(home)/.bun/bin/bun"
        return DevSourceConfig(sourcePath: source, bunPath: bun)
    }
}

/// Which app a takeover pointed ~/.local/bin/rt at, only when that is
/// unmistakable: the dev takeover writes a script whose second line is the
/// dev-mode marker (lib/dev-mode.ts DEV_MODE_TAG), the prod takeover links
/// an absolute path to a `mattstack.app` bundle's compiled rt. Everything
/// else, a legacy markerless wrapper included, is nobody's.
public enum RtLinkOwner {
    public static let devWrapperTag = "# mattstack-dev-mode"

    /// lib/dev-mode.test.ts pins this to the TS takeover's TRAY_APP_BUNDLE
    /// and RT_BUNDLE_PATH.
    public static let prodLinkSuffix = "/mattstack.app/Contents/MacOS/rt"

    /// `linkTarget` is the symlink's destination when the path is a link,
    /// with whether that destination exists; `prefix` is a bounded head of
    /// the file when it is not.
    public static func flavor(linkTarget: String?, linkTargetExists: Bool, prefix: String?) -> String? {
        if let linkTarget {
            return linkTargetExists && linkTarget.hasPrefix("/") && linkTarget.hasSuffix(prodLinkSuffix) ? "prod" : nil
        }
        guard let prefix, prefix.hasPrefix("#!") else { return nil }
        let lines = prefix.split(separator: "\n", maxSplits: 2, omittingEmptySubsequences: false)
        guard lines.count > 1, lines[1].hasPrefix(devWrapperTag) else { return nil }
        return "dev"
    }
}
