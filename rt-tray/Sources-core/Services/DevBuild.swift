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

    public static func newerBuildReady(running: String?, staged: String?) -> Bool {
        guard let running, let staged else { return false }
        return running != staged
    }

    /// A /bin/sh script that waits for `pid` to exit (giving up after 30s, so a
    /// cancelled quit never relaunches later), then swaps `stagedPath` into
    /// `appPath` by rename with rollback, reopens the app, and kickstarts the
    /// deck helper only when the bundle actually changed. With no staged path
    /// it is a plain relaunch.
    public static func handoffScript(pid: Int32, appPath: String, stagedPath: String?, deckLabel: String?,
                                     uid: UInt32, openPath: String = "/usr/bin/open",
                                     launchctlPath: String = "/bin/launchctl") -> String {
        let app = shellQuote(appPath)
        let aside = shellQuote(appPath + ".restart-old")
        var lines = [
            "i=0",
            "while kill -0 \(pid) 2>/dev/null; do i=$((i+1)); [ $i -ge 300 ] && exit 1; sleep 0.1; done",
            "swapped=0",
        ]
        if let stagedPath {
            let staged = shellQuote(stagedPath)
            lines += [
                "if [ -d \(staged) ]; then",
                "  rm -rf \(aside)",
                "  if mv \(app) \(aside); then",
                "    if mv \(staged) \(app); then swapped=1; rm -rf \(aside); else mv \(aside) \(app); fi",
                "  fi",
                "fi",
            ]
        }
        lines.append("\(shellQuote(openPath)) \(app)")
        if let deckLabel {
            lines.append("[ $swapped = 1 ] && \(shellQuote(launchctlPath)) kickstart -k gui/\(uid)/\(deckLabel)")
        }
        lines.append("exit 0")
        return lines.joined(separator: "\n")
    }

    static func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
