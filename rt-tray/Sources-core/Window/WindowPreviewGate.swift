import Foundation

/// The window preview runs the tray's own window code, so it may only run
/// where nothing it writes can land in an installed app's state: unbundled
/// (no bundle id, so no app's defaults domain) and under a HOME that is not
/// the account's own (so its log and its seeded catalog cache stay in a
/// scratch directory).
public enum WindowPreviewGate {
    public static func refusal(bundleIdentifier: String?, home: String?, accountHome: String) -> String? {
        if let bundleIdentifier {
            return "--window-preview refuses to run inside an app bundle (\(bundleIdentifier)); run the raw debug executable."
        }
        guard let home, !home.isEmpty else {
            return "--window-preview needs HOME set to a scratch directory (env -i HOME=<dir> ...)."
        }
        if canonical(home) == canonical(accountHome) {
            return "--window-preview refuses the account's own HOME; run it under env -i HOME=<scratch dir>."
        }
        return nil
    }

    private static func canonical(_ path: String) -> String {
        URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL.path
    }
}
