import Foundation

/// Finds the terminal-emulator app process that hosts a herdr pane, so the
/// tray can activate it after focusing the pane's workspace/tab. Pure over
/// injected process-table lookups; HerdrBridge supplies the real libproc ones.
public enum TerminalResolver {
    /// Bundle-path fragments for terminal emulators known to host herdr.
    public static let terminalBundleMarkers = [
        "/Ghostty.app/", "/iTerm.app/", "/Terminal.app/",
        "/WezTerm.app/", "/kitty.app/", "/Alacritty.app/", "/Warp.app/",
    ]

    /// Walks a pid's ancestor chain looking for a process whose executable
    /// lives inside a known terminal emulator's app bundle. Works when the
    /// pane's shell is parented (however indirectly) to the terminal; a
    /// daemon-hosted pane's chain tops out at launchd and yields nil.
    public static func terminalAppPid(
        ancestorOf pid: Int,
        parentOf: (Int) -> Int?,
        pathOf: (Int) -> String?
    ) -> Int? {
        var current = pid
        for _ in 0..<32 {
            if let path = pathOf(current),
               terminalBundleMarkers.contains(where: { path.contains($0) }) {
                return current
            }
            guard let parent = parentOf(current), parent > 1, parent != current else { return nil }
            current = parent
        }
        return nil
    }

    /// Fallback for daemon-hosted panes: the pane shell hangs off the
    /// launchd-parented herdr server, so its ancestry never reaches the
    /// terminal — but the attach client's does. Scans the process table for
    /// herdr executables and returns the first whose ancestry hits a
    /// terminal (the server's never does). With several attached clients in
    /// different terminals this picks the lowest-pid match; herdr's API has
    /// no way to say which client shows a given pane.
    public static func terminalAppPidViaHerdrClient(
        allPids: [Int],
        parentOf: (Int) -> Int?,
        pathOf: (Int) -> String?
    ) -> Int? {
        for pid in allPids.sorted() {
            guard let path = pathOf(pid),
                  (path as NSString).lastPathComponent == "herdr" else { continue }
            if let terminal = terminalAppPid(ancestorOf: pid, parentOf: parentOf, pathOf: pathOf) {
                return terminal
            }
        }
        return nil
    }
}
