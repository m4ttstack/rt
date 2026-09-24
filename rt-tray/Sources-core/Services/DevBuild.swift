import Foundation

/// The dev flavor's restart-to-new-build flow: a staged build carries a stamp
/// in its Info.plist, and a detached shell hands the swap off once the running
/// app has exited.
public enum DevBuild {
    public static let stampKey = "MSBuildStamp"

    /// Read from disk each time: `Bundle.main.infoDictionary` is cached at
    /// launch and never sees a bundle written afterwards.
    public static func stamp(atBundle path: String, readFile: (String) -> Data?) -> String? {
        guard let data = readFile("\(path)/Contents/Info.plist"),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let stamp = plist[stampKey] as? String, !stamp.isEmpty else { return nil }
        return stamp
    }

    /// A staged bundle only exists until a restart moves it, so it is never the
    /// running build; an unstamped running app (built from a pushed ref) still
    /// takes it.
    public static func newerBuildReady(running: String?, staged: String?) -> Bool {
        guard let staged else { return false }
        return running != staged
    }

    /// A /bin/sh script that waits for `pid` to exit (giving up after 30s, so a
    /// cancelled quit never relaunches later), then swaps `stagedPath` into
    /// `appPath` by rename with rollback and reopens the app. Only when the
    /// bundle changed does it restart the deck helper and then deck's managed
    /// apps: they run the bundle's Helpers/bun, and a process whose binary was
    /// deleted with the old bundle loses its privacy grants (EPERM reading
    /// ~/Documents). With no staged path it is a plain relaunch.
    public static func handoffScript(pid: Int32, appPath: String, stagedPath: String?, deckLabel: String?,
                                     uid: UInt32, logPath: String? = nil,
                                     openPath: String = "/usr/bin/open",
                                     launchctlPath: String = "/bin/launchctl",
                                     deckCLIPath: String? = nil) -> String {
        let app = shellQuote(appPath)
        let aside = shellQuote(appPath + ".restart-old")
        var lines: [String] = []
        // A failed exec redirect kills sh outright, which would leave the app
        // quit and never reopened; probing in a subshell makes logging optional.
        if let logPath {
            let log = shellQuote(logPath)
            lines.append("if ( : >> \(log) ) 2>/dev/null; then exec >> \(log) 2>&1; fi")
        }
        lines += [
            "echo \"handoff $(date '+%F %T') pid \(pid)\"",
            "i=0",
            "while kill -0 \(pid) 2>/dev/null; do i=$((i+1)); [ $i -ge 300 ] && { echo 'app did not exit; nothing changed'; exit 1; }; sleep 0.1; done",
            "swapped=0",
        ]
        if let stagedPath {
            let staged = shellQuote(stagedPath)
            // mv onto an existing directory moves INTO it, so the aside path
            // must be gone before the app is moved there.
            lines += [
                "if [ ! -d \(staged) ]; then echo 'no staged build'",
                "else",
                "  rm -rf \(aside)",
                "  if [ -e \(aside) ]; then echo 'stale aside copy could not be removed; not swapping'",
                "  elif mv \(app) \(aside); then",
                "    if mv \(staged) \(app); then swapped=1; rm -rf \(aside); echo swapped",
                "    else rm -rf \(app); mv \(aside) \(app); echo 'swap failed; previous app restored'; fi",
                "  fi",
                "fi",
            ]
        }
        lines.append("\(shellQuote(openPath)) \(app)")
        if let deckLabel {
            let deck = shellQuote(deckCLIPath ?? appPath + "/Contents/Helpers/deck")
            lines += [
                "if [ $swapped = 1 ]; then",
                "  \(shellQuote(launchctlPath)) kickstart -k gui/\(uid)/\(deckLabel)",
                // Retry only while deck is not answering: restart --managed
                // also fails when one app fails, and retrying that would
                // re-kill every healthy app each second.
                "  n=0; until \(deck) list --json >/dev/null 2>&1; do n=$((n+1)); [ $n -ge 30 ] && break; sleep 1; done",
                "  \(deck) restart --managed || echo 'restart --managed reported a failure'",
                "fi",
            ]
        }
        lines.append("exit 0")
        return lines.joined(separator: "\n")
    }

    static func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
