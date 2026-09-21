import AppKit
import Foundation
import MattstackCore

/// Asks a running flock to focus a pane.
///
/// flock knows which of its own windows holds a pane, so this needs none of
/// the process-ancestry guessing `HerdrBridge.focusPane` does for a pane
/// hosted by a terminal emulator.
///
/// One way only: macOS URL handling has no reply channel. Whether the pane
/// exists is answered before this runs, by the herdr lookup in
/// `focusPaneById`, so nothing here needs an answer.
enum FlockBridge {
    private static func runningBundleIDs() -> Set<String> {
        Set(NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier))
    }

    /// False means no flock is running and the caller should fall back. True
    /// means one was asked, not that it did anything.
    @discardableResult
    static func focusPane(_ paneId: String) -> Bool {
        guard
            let scheme = FlockFocusURL.scheme(forRunningBundleIDs: runningBundleIDs()),
            let url = FlockFocusURL.url(paneId: paneId, scheme: scheme)
        else { return false }

        let configuration = NSWorkspace.OpenConfiguration()
        // flock raises itself inside its own handler, so this must not also
        // do it: a request flock decides to ignore would otherwise still
        // steal the user's foreground app.
        configuration.activates = false
        // Hopped to main for the same reason the terminal raise below this
        // in `HerdrBridge.focusPane` is: callers reach here from the
        // tray's connection queue, and AppKit is not owed a background
        // thread. The open is asynchronous either way, so this costs the
        // caller nothing.
        DispatchQueue.main.async {
            NSWorkspace.shared.open(url, configuration: configuration, completionHandler: nil)
        }
        TrayLog.info("asked flock to focus pane", ["pane_id": paneId, "scheme": scheme])
        return true
    }
}
