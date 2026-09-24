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

private func read(_ url: URL) -> String { (try? String(contentsOf: url, encoding: .utf8)) ?? "" }

/// A stand-in for the opener, the helper tool, and deck's CLI that appends
/// its argv to a log.
private func recorder(_ dir: URL, _ name: String, log: URL, failing verb: String? = nil) -> String {
    let path = dir.appendingPathComponent(name).path
    let fail = verb.map { "[ \"$1\" = \($0) ] && exit 1\n" } ?? ""
    try! "#!/bin/sh\necho \"\(name) $*\" >> \"\(log.path)\"\n\(fail)exit 0\n".write(toFile: path, atomically: true, encoding: .utf8)
    chmod(path, 0o755)
    return path
}

private func runScript(_ script: String) -> Int32 {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/sh")
    p.arguments = ["-c", script]
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
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

private struct Rig {
    let dir: URL
    let app: URL
    let staged: URL
    let calls: URL
    let restartLog: URL

    init() {
        dir = tempDir()
        app = dir.appendingPathComponent("mattstack-dev.app")
        staged = dir.appendingPathComponent("staged/mattstack-dev.app")
        calls = dir.appendingPathComponent("calls.log")
        restartLog = dir.appendingPathComponent("restart.log")
    }

    func script(pid: Int32, staged: String?, deckLabel: String? = "com.mattstack.deck.dev",
                deckFailing: String? = nil, logPath: String? = nil) -> String {
        DevBuild.handoffScript(
            pid: pid, appPath: app.path, stagedPath: staged, deckLabel: deckLabel, uid: 501,
            logPath: logPath ?? restartLog.path,
            openPath: recorder(dir, "fake-open", log: calls),
            launchctlPath: recorder(dir, "fake-helper", log: calls),
            deckCLIPath: recorder(dir, "fake-deck", log: calls, failing: deckFailing))
    }
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
    Check("a staged build is ready when it differs from the running one") { c in
        c.expect(DevBuild.newerBuildReady(running: "a", staged: "b"))
        c.expect(!DevBuild.newerBuildReady(running: "a", staged: "a"))
        c.expect(!DevBuild.newerBuildReady(running: "a", staged: nil))
        c.expect(!DevBuild.newerBuildReady(running: nil, staged: nil))
    },
    Check("an unstamped running app (installed by a --ref rebuild) still offers a staged build") { c in
        c.expect(DevBuild.newerBuildReady(running: nil, staged: "b"))
    },
    Check("the handoff swaps the staged build in, reopens it, and restarts deck and the apps it manages") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        makeBundle(rig.staged, marker: "new")
        try c.requireEqual(runScript(rig.script(pid: deadPid(), staged: rig.staged.path)), 0)
        c.expectEqual(marker(rig.app), "new")
        c.expect(!FileManager.default.fileExists(atPath: rig.staged.path), "the staged bundle is moved, not copied")
        c.expect(!FileManager.default.fileExists(atPath: rig.app.path + ".restart-old"), "the aside copy is removed")
        c.expectEqual(read(rig.calls), """
            fake-open \(rig.app.path)
            fake-helper kickstart -k gui/501/com.mattstack.deck.dev
            fake-deck list --json
            fake-deck restart --managed

            """)
        c.expect(read(rig.restartLog).contains("swapped"), "the handoff logs what it did")
    },
    Check("a managed restart that reports a failure runs once, never in a loop that re-kills every app") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        makeBundle(rig.staged, marker: "new")
        c.expectEqual(runScript(rig.script(pid: deadPid(), staged: rig.staged.path, deckFailing: "restart")), 0)
        let restarts = read(rig.calls).components(separatedBy: "\n").filter { $0 == "fake-deck restart --managed" }
        c.expectEqual(restarts.count, 1)
    },
    Check("an unwritable handoff log never stops the swap and reopen") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        makeBundle(rig.staged, marker: "new")
        let nowhere = rig.dir.appendingPathComponent("missing-dir/restart.log").path
        c.expectEqual(runScript(rig.script(pid: deadPid(), staged: rig.staged.path, logPath: nowhere)), 0)
        c.expectEqual(marker(rig.app), "new")
        c.expect(read(rig.calls).hasPrefix("fake-open \(rig.app.path)\n"))
    },
    Check("a failed swap puts the previous app back, reopens it, and restarts nothing") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        c.expectEqual(runScript(rig.script(pid: deadPid(), staged: rig.staged.path)), 0)
        c.expectEqual(marker(rig.app), "old")
        c.expectEqual(read(rig.calls), "fake-open \(rig.app.path)\n")
    },
    Check("a stale aside copy that cannot be cleared stops the swap instead of nesting the app inside it") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        makeBundle(rig.staged, marker: "new")
        let aside = URL(fileURLWithPath: rig.app.path + ".restart-old")
        let locked = aside.appendingPathComponent("locked")
        try FileManager.default.createDirectory(at: locked, withIntermediateDirectories: true)
        try Data("x".utf8).write(to: locked.appendingPathComponent("f"))
        chmod(locked.path, 0o555)
        defer { chmod(locked.path, 0o755) }
        c.expectEqual(runScript(rig.script(pid: deadPid(), staged: rig.staged.path)), 0)
        c.expectEqual(marker(rig.app), "old")
        c.expectEqual(marker(rig.staged), "new", "the staged build stays for the next try")
        c.expectEqual(read(rig.calls), "fake-open \(rig.app.path)\n")
    },
    Check("a plain relaunch reopens the same app without swapping or restarting anything") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        c.expectEqual(runScript(rig.script(pid: deadPid(), staged: nil)), 0)
        c.expectEqual(marker(rig.app), "old")
        c.expectEqual(read(rig.calls), "fake-open \(rig.app.path)\n")
    },
    Check("the handoff waits for the running app to exit before touching anything") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        makeBundle(rig.staged, marker: "new")
        let sleeper = Process()
        sleeper.executableURL = URL(fileURLWithPath: "/bin/sleep")
        sleeper.arguments = ["0.5"]
        try sleeper.run()
        let started = Date()
        c.expectEqual(runScript(rig.script(pid: sleeper.processIdentifier, staged: rig.staged.path, deckLabel: nil)), 0)
        c.expect(Date().timeIntervalSince(started) >= 0.4, "returned before the pid exited")
        c.expectEqual(marker(rig.app), "new")
    },
    Check("paths with quotes and spaces survive the handoff script") { c in
        let base = tempDir().appendingPathComponent("it's a dir")
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        let app = base.appendingPathComponent("mattstack-dev.app")
        let staged = base.appendingPathComponent("staged/mattstack-dev.app")
        let calls = base.appendingPathComponent("calls.log")
        makeBundle(app, marker: "old")
        makeBundle(staged, marker: "new")
        let script = DevBuild.handoffScript(
            pid: deadPid(), appPath: app.path, stagedPath: staged.path, deckLabel: nil, uid: 501,
            logPath: base.appendingPathComponent("restart.log").path,
            openPath: recorder(base, "fake-open", log: calls),
            launchctlPath: recorder(base, "fake-helper", log: calls),
            deckCLIPath: recorder(base, "fake-deck", log: calls))
        c.expectEqual(runScript(script), 0)
        c.expectEqual(marker(app), "new")
        c.expect(read(calls).hasPrefix("fake-open \(app.path)\n"))
    },
]
