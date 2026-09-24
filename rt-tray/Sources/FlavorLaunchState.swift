import AppKit
import MattstackCore

/// Decided in `main.swift`, before any object graph exists, and read by the
/// AppDelegate once the launch origin is known.
enum FlavorLaunchState {
    /// The other flavor's tray, found live on `tray.sock` at launch.
    static var otherTrayAlive: String?

    /// Set only while this launch takes the Mac over: the one case that
    /// licenses evicting the other flavor's live tray from the socket.
    static var takingOver = false

    /// Links this launch was asked to open, kept in case the launch is
    /// handed to the other app.
    static var launchURLs: [URL] = []

    /// Set once a launch is being handed to the other app: later links follow it.
    static var handOffApp: URL?

    /// Whether LaunchServices knows the other flavor's bundle anywhere.
    static func siblingInstalled() -> Bool {
        guard let mine = Bundle.main.bundleIdentifier else { return false }
        return NSWorkspace.shared.urlForApplication(withBundleIdentifier: FlavorIdentity.sibling(ofBundleID: mine)) != nil
    }

    /// `RtLinkOwner.flavor` of ~/.local/bin/rt, read without following a
    /// link past its own destination and never more than a bounded head.
    static func rtOwner(home: String) -> String? {
        let path = home + "/.local/bin/rt"
        if let dest = try? FileManager.default.destinationOfSymbolicLink(atPath: path) {
            return RtLinkOwner.flavor(linkTarget: dest, linkTargetExists: FileManager.default.fileExists(atPath: dest),
                                      prefix: nil)
        }
        guard let handle = FileHandle(forReadingAtPath: path) else { return nil }
        defer { try? handle.close() }
        let head = (try? handle.read(upToCount: 4096)) ?? Data()
        return RtLinkOwner.flavor(linkTarget: nil, linkTargetExists: false, prefix: String(decoding: head, as: UTF8.self))
    }
}
