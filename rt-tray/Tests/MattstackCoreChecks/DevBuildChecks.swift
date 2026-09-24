import Foundation
import MattstackCore

private func plist(_ dict: [String: Any]) -> Data {
    try! PropertyListSerialization.data(fromPropertyList: dict, format: .xml, options: 0)
}

private func tempDir() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("devbuild-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func makeBundle(_ path: URL, marker: String) {
    let contents = path.appendingPathComponent("Contents")
    try! FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
    try! Data(marker.utf8).write(to: contents.appendingPathComponent("marker"))
}

private func marker(_ path: URL) -> String? {
    (try? String(contentsOf: path.appendingPathComponent("Contents/marker"), encoding: .utf8))
}

/// A stand-in for the opener and helper tool that appends its argv to a log.
private func recorder(_ dir: URL, _ name: String, log: URL) -> String {
    let path = dir.appendingPathComponent(name).path
    try! "#!/bin/sh\necho \"\(name) $*\" >> '\(log.path)'\n".write(toFile: path, atomically: true, encoding: .utf8)
    chmod(path, 0o755)
    return path
}

private func runScript(_ script: String) -> Int32 {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/sh")
    p.arguments = ["-c", script]
    try! p.run()
    p.waitUntilExit()
    return p.terminationStatus
}

/// A pid that has already exited, so the handoff's wait returns at once.
private func deadPid() -> Int32 {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/true")
    try! p.run()
    p.waitUntilExit()
    return p.processIdentifier
}

let devBuildChecks: [Check] = [
    Check("the build stamp is read from a bundle's Info.plist on disk") { c in
        let files = ["/A.app/Contents/Info.plist": plist(["MSBuildStamp": "2026-09-24 09:00:00 abc1234+dirty treebeard"])]
        c.expectEqual(DevBuild.stamp(atBundle: "/A.app", readFile: { files[$0] }),
                      "2026-09-24 09:00:00 abc1234+dirty treebeard")
        c.expectEqual(DevBuild.stamp(atBundle: "/B.app", readFile: { files[$0] }), nil)
        let unstamped = ["/C.app/Contents/Info.plist": plist(["CFBundleName": "x"])]
        c.expectEqual(DevBuild.stamp(atBundle: "/C.app", readFile: { unstamped[$0] }), nil)
        let empty = ["/D.app/Contents/Info.plist": plist(["MSBuildStamp": ""])]
        c.expectEqual(DevBuild.stamp(atBundle: "/D.app", readFile: { empty[$0] }), nil)
    },
    Check("a newer build is ready only when both stamps exist and differ") { c in
        c.expect(DevBuild.newerBuildReady(running: "a", staged: "b"))
        c.expect(!DevBuild.newerBuildReady(running: "a", staged: "a"))
        c.expect(!DevBuild.newerBuildReady(running: nil, staged: "b"), "an unstamped running app never offers a restart")
        c.expect(!DevBuild.newerBuildReady(running: "a", staged: nil))
    },
    Check("the handoff swaps the staged build in, reopens it, and restarts the deck helper") { c in
        let dir = tempDir()
        let app = dir.appendingPathComponent("mattstack-dev.app")
        let staged = dir.appendingPathComponent("staged/mattstack-dev.app")
        makeBundle(app, marker: "old")
        makeBundle(staged, marker: "new")
        let log = dir.appendingPathComponent("calls.log")
        let script = DevBuild.handoffScript(
            pid: deadPid(), appPath: app.path, stagedPath: staged.path, deckLabel: "com.mattstack.deck.dev", uid: 501,
            openPath: recorder(dir, "fake-open", log: log), launchctlPath: recorder(dir, "fake-helper", log: log))
        try c.requireEqual(runScript(script), 0)
        c.expectEqual(marker(app), "new")
        c.expect(!FileManager.default.fileExists(atPath: staged.path), "the staged bundle is moved, not copied")
        c.expect(!FileManager.default.fileExists(atPath: app.path + ".restart-old"), "the aside copy is removed")
        let calls = (try? String(contentsOf: log, encoding: .utf8)) ?? ""
        c.expectEqual(calls, "fake-open \(app.path)\nfake-helper kickstart -k gui/501/com.mattstack.deck.dev\n")
    },
    Check("a failed swap puts the previous app back and reopens it") { c in
        let dir = tempDir()
        let app = dir.appendingPathComponent("mattstack-dev.app")
        makeBundle(app, marker: "old")
        let log = dir.appendingPathComponent("calls.log")
        let missing = dir.appendingPathComponent("staged/mattstack-dev.app").path
        let script = DevBuild.handoffScript(
            pid: deadPid(), appPath: app.path, stagedPath: missing, deckLabel: "com.mattstack.deck.dev", uid: 501,
            openPath: recorder(dir, "fake-open", log: log), launchctlPath: recorder(dir, "fake-helper", log: log))
        c.expectEqual(runScript(script), 0)
        c.expectEqual(marker(app), "old")
        let calls = (try? String(contentsOf: log, encoding: .utf8)) ?? ""
        c.expectEqual(calls, "fake-open \(app.path)\n", "no helper restart when the bundle did not change")
    },
    Check("a plain relaunch reopens the same app without swapping or restarting helpers") { c in
        let dir = tempDir()
        let app = dir.appendingPathComponent("mattstack-dev.app")
        makeBundle(app, marker: "old")
        let log = dir.appendingPathComponent("calls.log")
        let script = DevBuild.handoffScript(
            pid: deadPid(), appPath: app.path, stagedPath: nil, deckLabel: "com.mattstack.deck.dev", uid: 501,
            openPath: recorder(dir, "fake-open", log: log), launchctlPath: recorder(dir, "fake-helper", log: log))
        c.expectEqual(runScript(script), 0)
        c.expectEqual(marker(app), "old")
        c.expectEqual((try? String(contentsOf: log, encoding: .utf8)) ?? "", "fake-open \(app.path)\n")
    },
    Check("the handoff waits for the running app to exit before touching anything") { c in
        let dir = tempDir()
        let app = dir.appendingPathComponent("mattstack-dev.app")
        let staged = dir.appendingPathComponent("staged/mattstack-dev.app")
        makeBundle(app, marker: "old")
        makeBundle(staged, marker: "new")
        let log = dir.appendingPathComponent("calls.log")
        let sleeper = Process()
        sleeper.executableURL = URL(fileURLWithPath: "/bin/sleep")
        sleeper.arguments = ["0.5"]
        try sleeper.run()
        let started = Date()
        let script = DevBuild.handoffScript(
            pid: sleeper.processIdentifier, appPath: app.path, stagedPath: staged.path, deckLabel: nil, uid: 501,
            openPath: recorder(dir, "fake-open", log: log), launchctlPath: recorder(dir, "fake-helper", log: log))
        c.expectEqual(runScript(script), 0)
        c.expect(Date().timeIntervalSince(started) >= 0.4, "returned before the pid exited")
        c.expectEqual(marker(app), "new")
    },
    Check("paths with quotes and spaces survive the handoff script") { c in
        let dir = tempDir().appendingPathComponent("it's a dir")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let app = dir.appendingPathComponent("mattstack-dev.app")
        let staged = dir.appendingPathComponent("staged/mattstack-dev.app")
        makeBundle(app, marker: "old")
        makeBundle(staged, marker: "new")
        let log = dir.appendingPathComponent("calls.log")
        let script = DevBuild.handoffScript(
            pid: deadPid(), appPath: app.path, stagedPath: staged.path, deckLabel: nil, uid: 501,
            openPath: recorder(dir, "fake-open", log: log), launchctlPath: recorder(dir, "fake-helper", log: log))
        c.expectEqual(runScript(script), 0)
        c.expectEqual(marker(app), "new")
    },
]
