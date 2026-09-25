import Foundation
import MattstackCore

/// No check file may name a process we must never spawn from a test, and
/// none may construct the real runner. Paths are relative to this file.
let sourceGuardChecks: [Check] = [
    Check("checks never name launchctl/pkill/tccutil/osascript/open(1) or SystemCommandRunner") { c in
        let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let files = try FileManager.default.contentsOfDirectory(atPath: here.path).filter { $0.hasSuffix(".swift") && $0 != "SourceGuardChecks.swift" }
        let forbidden = ["/bin/launchctl", "launchctl ", "pkill", "tccutil", "osascript", "/usr/bin/open", "SystemCommandRunner("]
        for f in files {
            let text = try String(contentsOfFile: here.appendingPathComponent(f).path, encoding: .utf8)
            for needle in forbidden where text.contains(needle) {
                c.fail("\(f) mentions forbidden '\(needle)'")
            }
        }
        c.expect(files.count >= 5)
    },
    Check("BadgePoller never fetches over URLSession.shared") { c in
        let sources = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../Sources").standardized
        let text = try String(contentsOf: sources.appendingPathComponent("Window/BadgePoller.swift"), encoding: .utf8)
        c.expect(!text.contains("URLSession.shared"), "BadgePoller.swift uses URLSession.shared")
    },
    /// Each allowed file fetches only deck.mattstack or the daemon on
    /// 127.0.0.1; a fetch to an app host needs its own session.
    Check("only deck and daemon callers use URLSession.shared") { c in
        let allowed: Set = ["WindowBackends.swift", "WindowModel.swift", "ServicesRegistrar.swift", "DaemonClient.swift"]
        let sources = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../Sources").standardized
        let files = try c.requireSome(FileManager.default.enumerator(atPath: sources.path))
            .compactMap { $0 as? String }.filter { $0.hasSuffix(".swift") }
        try c.require(files.count >= 20, "scanned only \(files.count) files under \(sources.path)")
        for f in files {
            let text = try String(contentsOf: sources.appendingPathComponent(f), encoding: .utf8)
            let name = (f as NSString).lastPathComponent
            if text.contains("URLSession.shared") && !allowed.contains(name) {
                c.fail("\(f) uses URLSession.shared")
            }
        }
    },
]
