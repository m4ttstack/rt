import AppKit
import MattstackCore

enum DevRebuildState: Equatable {
    case idle
    case building
    case failed
}

/// Dev flavor only. Watches the staging dir `scripts/build-dev-app.ts --local`
/// writes, publishes a staged build that differs from the running one, and
/// runs the restart, relaunch, and rebuild actions.
@MainActor
final class DevBuildWatcher {
    static let shared = DevBuildWatcher()

    private let root = NSHomeDirectory() + "/.mattstack/rt/dev-app"
    private var stagedApp: String { root + "/staged/mattstack-dev.app" }
    private var source: DispatchSourceFileSystemObject?
    private lazy var runningStamp = DevBuild.stamp(atBundle: Bundle.main.bundlePath, readFile: Self.read)

    private static func read(_ path: String) -> Data? { FileManager.default.contents(atPath: path) }

    /// repo-tools trees the daemon knows, for the Rebuild from… submenu.
    private(set) var sources: [RebuildSource] = []
    private static let rtRepoName = "remote:github.com%2Fm4ttstack%2Frt"

    func refreshSources() {
        guard BundleFlavor.isDevBuild else { return }
        Task {
            guard let payload = await DaemonClient().queryWorktreeList() else { return }
            let found = RebuildSources.sources(from: payload, repoName: Self.rtRepoName)
            await MainActor.run { self.sources = found }
        }
    }

    /// The tree the last `--local` build came from, which Rebuild repeats.
    /// Worktrees are disposed after merge, so a path the daemon no longer
    /// lists is dropped; the tray never stats it itself, since a checkout
    /// under ~/Documents would raise a privacy prompt for the dev app.
    var lastSource: String? {
        guard let raw = try? String(contentsOfFile: root + "/last-source", encoding: .utf8) else { return nil }
        let path = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return nil }
        if !sources.isEmpty, !sources.contains(where: { $0.path == path }) { return nil }
        return path
    }

    func start() {
        guard BundleFlavor.isDevBuild, source == nil else { return }
        try? FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
        let fd = open(root, O_EVTONLY)
        if fd >= 0 {
            let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete, .link],
                                                                queue: .main)
            src.setEventHandler { [weak self] in MainActor.assumeIsolated { self?.check() } }
            src.setCancelHandler { close(fd) }
            src.resume()
            source = src
        }
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil,
                                               queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.check() }
        }
        check()
        refreshSources()
    }

    func check() {
        guard BundleFlavor.isDevBuild else { return }
        let staged = DevBuild.stamp(atBundle: stagedApp, readFile: Self.read)
        TrayState.shared.stagedBuildStamp = DevBuild.newerBuildReady(running: runningStamp, staged: staged) ? staged : nil
    }

    func restartIntoStaged(quit: () -> Void) {
        handOff(stagedPath: stagedApp, deckLabel: "com.mattstack.deck.dev", quit: quit)
    }

    func relaunch(quit: () -> Void) {
        handOff(stagedPath: nil, deckLabel: nil, quit: quit)
    }

    private func handOff(stagedPath: String?, deckLabel: String?, quit: () -> Void) {
        guard BundleFlavor.isDevBuild else { return }
        let logs = NSHomeDirectory() + "/.mattstack/rt/logs"
        try? FileManager.default.createDirectory(atPath: logs, withIntermediateDirectories: true)
        let script = DevBuild.handoffScript(pid: getpid(), appPath: Bundle.main.bundlePath, stagedPath: stagedPath,
                                            deckLabel: deckLabel, uid: getuid(),
                                            logPath: logs + "/dev-app-restart.log")
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/sh")
        proc.arguments = ["-c", script]
        do {
            try proc.run()
        } catch {
            TrayLog.error("dev restart handoff failed to start", ["err": String(describing: error)])
            return
        }
        quit()
    }

    func rebuild(from path: String? = nil) {
        guard let tree = path ?? lastSource, TrayState.shared.devRebuild != .building else { return }
        let logs = NSHomeDirectory() + "/.mattstack/rt/logs"
        try? FileManager.default.createDirectory(atPath: logs, withIntermediateDirectories: true)
        let logPath = logs + "/dev-app-build.log"
        if !FileManager.default.fileExists(atPath: logPath) { FileManager.default.createFile(atPath: logPath, contents: nil) }
        guard let log = FileHandle(forWritingAtPath: logPath) else { return }
        log.seekToEndOfFile()

        let home = NSHomeDirectory()
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: home + "/.bun/bin/bun")
        proc.arguments = ["scripts/build-dev-app.ts", "--local", "--yes"]
        proc.currentDirectoryURL = URL(fileURLWithPath: tree)
        // A tray launched by launchd has a bare PATH; the build needs swift,
        // xcodegen, rsync and bun.
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "\(home)/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        proc.environment = env
        proc.standardOutput = log
        proc.standardError = log
        proc.terminationHandler = { p in
            let ok = p.terminationStatus == 0
            try? log.close()
            Task { @MainActor in
                DevBuildWatcher.shared.setRebuild(ok ? .idle : .failed, tree: tree)
                DevBuildWatcher.shared.check()
            }
        }
        log.write(Data("\n== rebuild from \(tree) at \(Date())\n".utf8))
        do {
            try proc.run()
            setRebuild(.building, tree: tree)
        } catch {
            try? log.close()
            TrayLog.error("dev rebuild failed to start", ["err": String(describing: error)])
            setRebuild(.failed, tree: tree)
        }
    }

    var buildLogPath: String { NSHomeDirectory() + "/.mattstack/rt/logs/dev-app-build.log" }

    private func setRebuild(_ state: DevRebuildState, tree: String) {
        TrayState.shared.devRebuild = state
        TrayState.shared.devRebuildTree = (tree as NSString).lastPathComponent
        NotificationCenter.default.post(name: .rtDevRebuildChanged, object: nil)
    }
}
