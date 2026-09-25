import Foundation
@testable import MattstackCore

private let trayRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private func traySource(_ relative: String) throws -> String {
    try String(contentsOf: trayRoot.appendingPathComponent(relative), encoding: .utf8)
}

/// Names of the tray's launch machinery: flavor launch and takeover, agent
/// and login-item registration, the tray socket, launch-state defaults,
/// version-change handling, update checks and the subprocess runner.
private let launchMachinery = [
    "AppDelegate", "FlavorLaunch", "SMAppService", "ServicesRegistrar", "DaemonLifecycle",
    "LoginItemPreference", "TrayServer", "UserDefaults", "VersionChangeDetector", "handleVersionChange",
    "UpdaterController", "SPUUpdater", "SystemCommandRunner", "installTrayCrashHandlers",
]

let windowPreviewGateChecks: [Check] = [
    Check("window preview gate: refuses to run inside any app bundle") { c in
        c.expect(WindowPreviewGate.refusal(bundleIdentifier: "com.mattstack.app", home: "/tmp/scratch",
                                           accountHome: "/Users/me") != nil)
        c.expect(WindowPreviewGate.refusal(bundleIdentifier: "com.mattstack.app.dev", home: "/tmp/scratch",
                                           accountHome: "/Users/me") != nil)
    },
    Check("window preview gate: refuses the account's own HOME, however it is spelled") { c in
        c.expect(WindowPreviewGate.refusal(bundleIdentifier: nil, home: "/Users/me", accountHome: "/Users/me") != nil)
        c.expect(WindowPreviewGate.refusal(bundleIdentifier: nil, home: "/Users/me/", accountHome: "/Users/me") != nil)
        c.expect(WindowPreviewGate.refusal(bundleIdentifier: nil, home: "/Users/me/.", accountHome: "/Users/me") != nil)
    },
    Check("window preview gate: refuses an unset or empty HOME") { c in
        c.expect(WindowPreviewGate.refusal(bundleIdentifier: nil, home: nil, accountHome: "/Users/me") != nil)
        c.expect(WindowPreviewGate.refusal(bundleIdentifier: nil, home: "", accountHome: "/Users/me") != nil)
    },
    Check("window preview gate: runs unbundled under a scratch HOME") { c in
        c.expectEqual(WindowPreviewGate.refusal(bundleIdentifier: nil, home: "/tmp/scratch/home",
                                                accountHome: "/Users/me"), nil)
    },
    Check("window preview gate: main.swift hands off to the preview before any launch step") { c in
        let main = try traySource("Sources/main.swift")
        let dispatch = try c.requireSome(main.range(of: "\"--window-preview\""), "main.swift never routes --window-preview")
        let debugOpen = try c.requireSome(main.range(of: "#if DEBUG"), "main.swift has no DEBUG block")
        let debugClose = try c.requireSome(main.range(of: "#endif"), "main.swift has no DEBUG block end")
        c.expect(debugOpen.upperBound <= dispatch.lowerBound && dispatch.upperBound <= debugClose.lowerBound,
                 "--window-preview must be routed inside the first DEBUG block")
        for step in ["installTrayCrashHandlers()", "TrayLog.info(\"tray launched\"", "TrayServer.launchSocketVerdict()",
                     "AppDelegate()", "app.run()"] {
            let at = try c.requireSome(main.range(of: step), "main.swift no longer has \(step)")
            c.expect(dispatch.upperBound <= at.lowerBound, "--window-preview must be routed before \(step)")
        }
    },
    Check("window preview gate: the harness gates first, never returns and names no launch machinery") { c in
        let preview = try traySource("Sources/Window/WindowPreview.swift")
        c.expect(preview.contains("static func run(arguments: [String]) -> Never"), "run(arguments:) must not return")
        let body = try c.requireSome(preview.range(of: "static func run(arguments: [String]) -> Never {"))
        let gate = try c.requireSome(preview.range(of: "WindowPreviewGate.refusal("), "the harness never asks the gate")
        let app = try c.requireSome(preview.range(of: "NSApplication.shared"))
        c.expect(body.upperBound <= gate.lowerBound && gate.upperBound <= app.lowerBound,
                 "the gate must run before the harness touches NSApplication")
        for name in launchMachinery + ["WindowBackends.live", ".live()"] where preview.contains(name) {
            c.fail("WindowPreview.swift names \(name)")
        }
    },
    Check("window preview gate: the window views and model name no launch machinery") { c in
        let dir = trayRoot.appendingPathComponent("Sources/Window")
        let files = try FileManager.default.contentsOfDirectory(atPath: dir.path)
            .filter { $0.hasSuffix(".swift") && $0 != "WindowBackends.swift" }
        c.expect(files.contains("WindowModel.swift") && files.contains("MattstackWindowView.swift"))
        for file in files {
            let text = try String(contentsOf: dir.appendingPathComponent(file), encoding: .utf8)
            for name in launchMachinery where text.contains(name) { c.fail("\(file) names \(name)") }
        }
    },
    Check("window preview gate: the live window backends only read agent state") { c in
        let backends = try traySource("Sources/Window/WindowBackends.swift")
        for write in [".register(", ".unregister(", "registerAll", "UserDefaults", "TrayServer", "kickstart", "bootout",
                      "handleVersionChange"] where backends.contains(write) {
            c.fail("WindowBackends.swift names \(write)")
        }
    },
]
