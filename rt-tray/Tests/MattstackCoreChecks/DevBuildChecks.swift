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

/// A stand-in opener that records whether `path` exists at the moment the
/// app is reopened.
private func existenceProbe(_ dir: URL, watching path: String, log: URL) -> String {
    let probe = dir.appendingPathComponent("probe-open").path
    let body = "#!/bin/sh\nif [ -e '\(path)' ]; then echo present; else echo gone; fi >> '\(log.path)'\n"
    try! body.write(toFile: probe, atomically: true, encoding: .utf8)
    chmod(probe, 0o755)
    return probe
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

    var builds: URL { dir.appendingPathComponent("dev-app/builds") }

    func script(pid: Int32, staged: String?, deckLabel: String? = "com.mattstack.deck.dev",
                deckFailing: String? = nil, logPath: String? = nil, cache: DevBuild.CacheTarget? = nil) -> String {
        DevBuild.handoffScript(
            pid: pid, appPath: app.path, stagedPath: staged, deckLabel: deckLabel, uid: 501,
            logPath: logPath ?? restartLog.path,
            openPath: recorder(dir, "fake-open", log: calls),
            launchctlPath: recorder(dir, "fake-helper", log: calls),
            deckCLIPath: recorder(dir, "fake-deck", log: calls, failing: deckFailing),
            cache: cache)
    }

    func cacheTarget(_ entry: String = "tree-abc") -> DevBuild.CacheTarget {
        DevBuild.CacheTarget(buildsDir: builds.path, entryName: entry)!
    }
}

private let sampleIdentity = DevBuild.BuildIdentity(tree: "/trees/smaug", sha: String(repeating: "a", count: 40),
                                                    diffHash: "clean")

private func identityPlist(_ id: DevBuild.BuildIdentity, stamp: String = "s") -> Data {
    plist(["MSBuildStamp": stamp, "MSBuildTree": id.tree, "MSBuildSha": id.sha, "MSBuildDiffHash": id.diffHash])
}

private func seedEntry(_ builds: URL, _ name: String, cachedAt: String?, marker m: String) {
    let entry = builds.appendingPathComponent(name)
    makeBundle(entry.appendingPathComponent("bundle"), marker: m)
    if let cachedAt { try! Data(cachedAt.utf8).write(to: entry.appendingPathComponent("cached-at")) }
}

private func entries(_ builds: URL) -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: builds.path)) ?? []).sorted()
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
            deckCLIPath: recorder(base, "fake-deck", log: calls),
            cache: DevBuild.CacheTarget(buildsDir: base.appendingPathComponent("dev-app/builds").path, entryName: "tree-abc"))
        c.expectEqual(runScript(script), 0)
        c.expectEqual(marker(app), "new")
        c.expectEqual(marker(base.appendingPathComponent("dev-app/builds/tree-abc/bundle")), "old")
        c.expect(read(calls).hasPrefix("fake-open \(app.path)\n"))
    },
    Check("a bundle's build identity is read from its Info.plist, and only when all three keys are there") { c in
        let files = [
            "/A.app/Contents/Info.plist": identityPlist(sampleIdentity),
            "/B.app/Contents/Info.plist": plist(["MSBuildStamp": "s", "MSBuildTree": "/t", "MSBuildSha": "abc"]),
            "/C.app/Contents/Info.plist": plist(["MSBuildStamp": "s", "MSBuildTree": "/t", "MSBuildSha": "",
                                                 "MSBuildDiffHash": "clean"]),
        ]
        c.expectEqual(DevBuild.identity(atBundle: "/A.app", readFile: { files[$0] }), sampleIdentity)
        c.expectEqual(DevBuild.identity(atBundle: "/B.app", readFile: { files[$0] }), nil)
        c.expectEqual(DevBuild.identity(atBundle: "/C.app", readFile: { files[$0] }), nil)
        c.expectEqual(DevBuild.identity(atBundle: "/D.app", readFile: { files[$0] }), nil)
    },
    Check("a cache entry name is path-safe, stable per identity, and distinct across tree, sha and diff") { c in
        let odd = DevBuild.BuildIdentity(tree: "/trees/../it's a \"tree\"/.hidden", sha: sampleIdentity.sha, diffHash: "x")
        for id in [sampleIdentity, odd] {
            let name = DevBuild.cacheEntryName(for: id)
            c.expect(!name.isEmpty && !name.hasPrefix("."), "\(name) must not be hidden or empty")
            c.expect(name.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "-_.".contains($0)) },
                     "\(name) has unsafe characters")
        }
        let name = DevBuild.cacheEntryName(for: sampleIdentity)
        c.expectEqual(name, DevBuild.cacheEntryName(for: sampleIdentity))
        c.expect(name.hasPrefix("smaug-aaaaaaaaaaaa-"), "names lead with the tree and short sha: \(name)")
        var others = [DevBuild.BuildIdentity]()
        others.append(.init(tree: "/other/smaug", sha: sampleIdentity.sha, diffHash: "clean"))
        others.append(.init(tree: sampleIdentity.tree, sha: String(repeating: "b", count: 40), diffHash: "clean"))
        others.append(.init(tree: sampleIdentity.tree, sha: sampleIdentity.sha, diffHash: "0f0f"))
        for other in others { c.expect(DevBuild.cacheEntryName(for: other) != name, "\(other) collides") }
    },
    Check("a cache target only ever points at a plain child of an absolute builds dir") { c in
        c.expect(DevBuild.CacheTarget(buildsDir: "/h/.mattstack/rt/dev-app/builds", entryName: "tree-abc") != nil)
        c.expect(DevBuild.CacheTarget(buildsDir: "relative/builds", entryName: "tree-abc") == nil)
        c.expect(DevBuild.CacheTarget(buildsDir: "/h/dev-app/other", entryName: "tree-abc") == nil)
        c.expect(DevBuild.CacheTarget(buildsDir: "/h/../builds", entryName: "tree-abc") == nil)
        for bad in ["", ".", "..", ".hidden", "a/b"] {
            c.expect(DevBuild.CacheTarget(buildsDir: "/h/builds", entryName: bad) == nil, "\(bad) accepted")
        }
    },
    Check("the handoff files the outgoing app in the build cache instead of deleting it") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        makeBundle(rig.staged, marker: "new")
        try c.requireEqual(runScript(rig.script(pid: deadPid(), staged: rig.staged.path, cache: rig.cacheTarget())), 0)
        c.expectEqual(marker(rig.app), "new")
        c.expectEqual(marker(rig.builds.appendingPathComponent("tree-abc/bundle")), "old")
        c.expect(!read(rig.builds.appendingPathComponent("tree-abc/cached-at")).isEmpty, "the entry records when it was cached")
        c.expect(!FileManager.default.fileExists(atPath: rig.app.path + ".restart-old"), "the aside copy is gone")
        c.expectEqual(entries(rig.builds), ["tree-abc"], "no in-flight leftovers")
        let appDirs = (FileManager.default.subpaths(atPath: rig.builds.path) ?? []).filter { $0.hasSuffix(".app") }
        c.expectEqual(appDirs, [], "a cached bundle never carries .app, so LaunchServices never registers it")
        c.expectEqual(read(rig.calls), """
            fake-open \(rig.app.path)
            fake-helper kickstart -k gui/501/com.mattstack.deck.dev
            fake-deck list --json
            fake-deck restart --managed

            """)
    },
    Check("caching over an existing entry for the same build replaces it") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        makeBundle(rig.staged, marker: "new")
        seedEntry(rig.builds, "tree-abc", cachedAt: "100", marker: "older copy")
        c.expectEqual(runScript(rig.script(pid: deadPid(), staged: rig.staged.path, cache: rig.cacheTarget())), 0)
        c.expectEqual(marker(rig.builds.appendingPathComponent("tree-abc/bundle")), "old")
        c.expect(!FileManager.default.fileExists(atPath: rig.builds.appendingPathComponent("tree-abc/bundle/bundle").path),
                 "the new copy replaced the entry rather than nesting inside it")
    },
    Check("the cache keeps the four most recently cached builds and deletes nothing outside it") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        makeBundle(rig.staged, marker: "new")
        seedEntry(rig.builds, "e100", cachedAt: "100", marker: "x")
        seedEntry(rig.builds, "e400", cachedAt: "400", marker: "x")
        seedEntry(rig.builds, "e200", cachedAt: "200", marker: "x")
        seedEntry(rig.builds, "e300", cachedAt: "300", marker: "x")
        seedEntry(rig.builds, "unstamped", cachedAt: nil, marker: "x")
        let neighbour = rig.dir.appendingPathComponent("dev-app/builds-neighbour")
        makeBundle(neighbour, marker: "keep")
        c.expectEqual(runScript(rig.script(pid: deadPid(), staged: rig.staged.path, cache: rig.cacheTarget())), 0)
        c.expectEqual(entries(rig.builds), ["e200", "e300", "e400", "tree-abc"])
        c.expectEqual(marker(neighbour), "keep")
    },
    Check("a cache that cannot be written never stops the swap; the outgoing app is deleted as before") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        makeBundle(rig.staged, marker: "new")
        try FileManager.default.createDirectory(at: rig.builds.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not a dir".utf8).write(to: rig.builds)
        c.expectEqual(runScript(rig.script(pid: deadPid(), staged: rig.staged.path, cache: rig.cacheTarget())), 0)
        c.expectEqual(marker(rig.app), "new")
        c.expect(!FileManager.default.fileExists(atPath: rig.app.path + ".restart-old"), "the aside copy is removed")
        c.expect(read(rig.calls).hasPrefix("fake-open \(rig.app.path)\nfake-helper kickstart"))
        c.expect(read(rig.restartLog).contains("could not cache"), "the failure is logged")
    },
    Check("a failed swap caches nothing and still restores the previous app") { c in
        let rig = Rig()
        makeBundle(rig.app, marker: "old")
        c.expectEqual(runScript(rig.script(pid: deadPid(), staged: rig.staged.path, cache: rig.cacheTarget())), 0)
        c.expectEqual(marker(rig.app), "old")
        c.expectEqual(entries(rig.builds), [])
    },
    Check("cached identities come from each entry's bundle, skipping in-flight dot entries") { c in
        let other = DevBuild.BuildIdentity(tree: "/trees/main", sha: String(repeating: "c", count: 40), diffHash: "clean")
        let files = [
            "/b/one/bundle/Contents/Info.plist": identityPlist(sampleIdentity),
            "/b/two/bundle/Contents/Info.plist": identityPlist(other),
            "/b/.incoming-9/bundle/Contents/Info.plist": identityPlist(other),
        ]
        let found = DevBuild.cachedIdentities(buildsDir: "/b", listDir: { $0 == "/b" ? ["one", ".incoming-9", "two", "junk"] : [] },
                                              readFile: { files[$0] })
        c.expectEqual(found, [sampleIdentity, other])
    },
    Check("the outgoing app leaves the shared aside path before the app reopens, so a second handoff cannot touch it") { c in
        for cached in [false, true] {
            let rig = Rig()
            makeBundle(rig.app, marker: "old")
            makeBundle(rig.staged, marker: "new")
            let probeLog = rig.dir.appendingPathComponent("probe.log")
            let script = DevBuild.handoffScript(
                pid: deadPid(), appPath: rig.app.path, stagedPath: rig.staged.path, deckLabel: nil, uid: 501,
                logPath: rig.restartLog.path,
                openPath: existenceProbe(rig.dir, watching: rig.app.path + ".restart-old", log: probeLog),
                cache: cached ? rig.cacheTarget() : nil)
            c.expectEqual(runScript(script), 0)
            c.expectEqual(read(probeLog), "gone\n", cached ? "with a cache target" : "without a cache target")
            if cached { c.expectEqual(marker(rig.builds.appendingPathComponent("tree-abc/bundle")), "old") }
        }
    },
]
