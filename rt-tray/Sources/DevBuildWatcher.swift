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

    enum SourcesState { case loading, loaded, unreachable }

    /// repo-tools trees the daemon knows, for the Rebuild from… submenu.
    private(set) var sources: [RebuildSource] = []
    private(set) var sourcesState: SourcesState = .loading
    private static let rtRepoName = "remote:github.com%2Fm4ttstack%2Frt"

    /// Called with the new list, so an open Rebuild from… submenu can refill
    /// in place instead of waiting for the menu to be reopened.
    var onSourcesChanged: (() -> Void)?
    private var refreshing = false

    /// Retries for a while: right after a relaunch the daemon is still
    /// starting and the first queries fail.
    func refreshSources() {
        guard BundleFlavor.isDevBuild, !refreshing else { return }
        refreshing = true
        Task {
            var payload: WorktreeListPayload?
            for attempt in 0..<15 {
                payload = await DaemonClient().queryWorktreeList()
                if payload != nil { break }
                if attempt < 14 { try? await Task.sleep(nanoseconds: 2_000_000_000) }
            }
            let found = payload.map { RebuildSources.sources(from: $0, repoName: Self.rtRepoName) }
            await MainActor.run {
                self.refreshing = false
                let state: SourcesState = found == nil ? .unreachable : .loaded
                guard state != self.sourcesState || (found.map { $0 != self.sources } ?? false) else { return }
                self.sourcesState = state
                if let found { self.sources = found }
                self.onSourcesChanged?()
            }
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
        let ready = DevBuild.newerBuildReady(running: runningStamp, staged: staged) ? staged : nil
        guard ready != TrayState.shared.stagedBuildStamp else { return }
        TrayState.shared.stagedBuildStamp = ready
        // A newer staged build (from the tray or a terminal) supersedes an
        // earlier failed tray rebuild.
        if ready != nil, TrayState.shared.devRebuild == .failed { TrayState.shared.devRebuild = .idle }
        NotificationCenter.default.post(name: .rtDevRebuildChanged, object: nil)
    }

    func restartIntoStaged(quit: () -> Void) {
        handOff(stagedPath: stagedApp, deckLabel: "com.mattstack.deck.dev", quit: quit)
    }

    func discardStaged() {
        let logs = NSHomeDirectory() + "/.mattstack/rt/logs"
        try? FileManager.default.createDirectory(atPath: logs, withIntermediateDirectories: true)
        let cache = DevBuild.identity(atBundle: stagedApp, readFile: Self.read).flatMap {
            DevBuild.CacheTarget(buildsDir: buildsDir, entryName: DevBuild.cacheEntryName(for: $0))
        }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/sh")
        proc.arguments = ["-c", DevBuild.discardScript(stagedPath: stagedApp, logPath: logs + "/dev-app-restart.log",
                                                       cache: cache)]
        proc.terminationHandler = { _ in Task { @MainActor in DevBuildWatcher.shared.check() } }
        do {
            try proc.run()
        } catch {
            TrayLog.error("dev discard failed to start", ["err": String(describing: error)])
        }
    }

    private var buildsDir: String { root + "/builds" }

    /// Builds the restart handoff would swap back in without rebuilding, for
    /// the Rebuild from… labels. At most `DevBuild.cacheKeep` small plist reads.
    func cachedBuilds() -> [DevBuild.BuildIdentity] {
        DevBuild.cachedIdentities(buildsDir: buildsDir,
                                  listDir: { (try? FileManager.default.contentsOfDirectory(atPath: $0)) ?? [] },
                                  readFile: Self.read)
    }

    private func handOff(stagedPath: String?, deckLabel: String?, quit: () -> Void) {
        guard BundleFlavor.isDevBuild else { return }
        let logs = NSHomeDirectory() + "/.mattstack/rt/logs"
        try? FileManager.default.createDirectory(atPath: logs, withIntermediateDirectories: true)
        // Only a bundle that says what it was built from can be found again.
        let cache = stagedPath == nil ? nil : DevBuild.identity(atBundle: Bundle.main.bundlePath, readFile: Self.read).flatMap {
            DevBuild.CacheTarget(buildsDir: buildsDir, entryName: DevBuild.cacheEntryName(for: $0))
        }
        let script = DevBuild.handoffScript(pid: getpid(), appPath: Bundle.main.bundlePath, stagedPath: stagedPath,
                                            deckLabel: deckLabel, uid: getuid(),
                                            logPath: logs + "/dev-app-restart.log", cache: cache)
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
