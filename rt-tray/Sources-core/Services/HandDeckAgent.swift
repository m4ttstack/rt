import Foundation

/// Retires a hand-installed deck LaunchAgent (`deck setup` writes one into
/// ~/Library/LaunchAgents) so the bundle's SMAppService deck helper is deck's
/// only supervisor. Mirrors rt's lib/deck-hand-agent.ts.
///
/// The prod helper reuses the label `com.mattstack.deck`, so only a job whose
/// launchd `path` is the ~/Library/LaunchAgents plist is booted out; an
/// SMAppService job prints `path = (submitted by smd.<pid>)` instead.
public enum HandDeckFailStage: Equatable, Sendable {
    /// launchctl print failed for a reason other than a missing service, so
    /// whether a hand job holds the label is unknown.
    case probe
    /// A hand job is confirmed loaded and still holds the label.
    case bootout
    case archive(bootedOut: Bool)
}

public enum HandDeckRetireOutcome: Equatable, Sendable {
    case absent
    case retired(bootedOut: Bool, archivedTo: String)
    case failed(String, stage: HandDeckFailStage)

    public var name: String {
        switch self {
        case .absent: return "absent"
        case .retired: return "retired"
        case .failed: return "failed"
        }
    }

    /// A hand job was loaded under the label, so an SMAppService helper that
    /// shares it could not have been bootstrapped and must be resubmitted.
    public var freedLoadedLabel: Bool {
        switch self {
        case .retired(bootedOut: true, _), .failed(_, stage: .archive(bootedOut: true)): return true
        default: return false
        }
    }

    public var labelMayBeHeld: Bool {
        switch self {
        case .failed(_, stage: .probe), .failed(_, stage: .bootout): return true
        default: return false
        }
    }
}

public struct HandDeckFS: Sendable {
    public let exists: @Sendable (String) -> Bool
    public let createDirectory: @Sendable (String) throws -> Void
    public let move: @Sendable (String, String) throws -> Void

    public init(exists: @escaping @Sendable (String) -> Bool,
                createDirectory: @escaping @Sendable (String) throws -> Void,
                move: @escaping @Sendable (String, String) throws -> Void) {
        self.exists = exists; self.createDirectory = createDirectory; self.move = move
    }

    public static let system = HandDeckFS(
        exists: { FileManager.default.fileExists(atPath: $0) },
        createDirectory: { try FileManager.default.createDirectory(atPath: $0, withIntermediateDirectories: true) },
        move: { try FileManager.default.moveItem(atPath: $0, toPath: $1) })
}

public struct HandDeckBlockedNotice: Equatable, Sendable {
    public let summary: String
    public let reason: String
    public let fixCommand: String
}

public enum HandDeckAgent {
    public static let label = "com.mattstack.deck"
    static let launchctlPath = "/bin/launchctl"
    /// launchctl print's exit status for a service the domain does not have.
    static let serviceNotFoundExit: Int32 = 113

    public static func plistPath(home: String) -> String { "\(home)/Library/LaunchAgents/\(label).plist" }
    public static func retiredPath(home: String) -> String { "\(home)/.mattstack/deck/\(label).plist.retired" }

    /// Run before registering the bundle's agents. Only the prod deck helper
    /// shares the hand agent's label, so any other helper set returns nil
    /// without a launchctl call.
    public static func clearLabel(forHelpers helperLabels: [String], home: String, uid: uid_t, runner: CommandRunner,
                                  fs: HandDeckFS, now: () -> Date = Date.init) async -> HandDeckRetireOutcome? {
        guard helperLabels.contains(label) else { return nil }
        return await retire(home: home, uid: uid, runner: runner, fs: fs, now: now)
    }

    static func archiveDestination(home: String, fs: HandDeckFS, now: () -> Date) -> String {
        let base = retiredPath(home: home)
        return fs.exists(base) ? "\(base).\(Int64(now().timeIntervalSince1970 * 1000))" : base
    }

    private static func shellQuoted(_ s: String) -> String { "'\(s.replacingOccurrences(of: "'", with: "'\\''"))'" }

    public static func blockedNotice(for outcome: HandDeckRetireOutcome, home: String, uid: uid_t, fs: HandDeckFS,
                                     now: () -> Date = Date.init) -> HandDeckBlockedNotice? {
        guard case .failed(let reason, let stage) = outcome else { return nil }
        let dest = archiveDestination(home: home, fs: fs, now: now)
        let dir = (dest as NSString).deletingLastPathComponent
        var lines = ["mkdir -p \(shellQuoted(dir)) && mv -n \(shellQuoted(plistPath(home: home))) \(shellQuoted(dest))"]
        if stage == .bootout {
            // Re-checked at paste time: once the helper holds the label, a bare
            // bootout by label would remove the helper instead.
            let target = "gui/\(uid)/\(label)"
            let probe = "launchctl print \(target) | grep -cF \(shellQuoted("path = \(plistPath(home: home))"))"
            lines.insert("[ \"$(\(probe))\" -gt 0 ] && launchctl bootout \(target)", at: 0)
        }
        return HandDeckBlockedNotice(summary: "A hand-installed deck agent is blocking the deck helper.",
                                     reason: reason, fixCommand: lines.joined(separator: "\n"))
    }

    public static func retire(home: String, uid: uid_t, runner: CommandRunner, fs: HandDeckFS,
                              now: () -> Date = Date.init) async -> HandDeckRetireOutcome {
        let plist = plistPath(home: home)
        guard fs.exists(plist) else { return .absent }

        let target = "gui/\(uid)/\(label)"
        let print = await runner.run(launchctlPath, ["print", target])
        if !print.ok && print.exitCode != serviceNotFoundExit {
            return .failed("print \(target) exited \(print.exitCode): \((print.stderr + print.stdout).trimmingCharacters(in: .whitespacesAndNewlines))",
                           stage: .probe)
        }
        var bootedOut = false
        let loadedFromPlist = print.ok && print.stdout.split(separator: "\n")
            .contains { $0.trimmingCharacters(in: .whitespaces) == "path = \(plist)" }
        if loadedFromPlist {
            let bootout = await runner.run(launchctlPath, ["bootout", target])
            guard bootout.ok else {
                return .failed("bootout \(target) exited \(bootout.exitCode): \((bootout.stderr + bootout.stdout).trimmingCharacters(in: .whitespacesAndNewlines))",
                               stage: .bootout)
            }
            bootedOut = true
        }

        let archivedTo = archiveDestination(home: home, fs: fs, now: now)
        do {
            try fs.createDirectory((archivedTo as NSString).deletingLastPathComponent)
            try fs.move(plist, archivedTo)
        } catch {
            return .failed("could not archive \(plist): \(error.localizedDescription)", stage: .archive(bootedOut: bootedOut))
        }
        return .retired(bootedOut: bootedOut, archivedTo: archivedTo)
    }
}

/// Several callers can register the deck helper at once (launch, rt's
/// /services/register, a need). Two interleaved preflights both see the hand
/// job loaded, and the loser's bootout fails on a service the winner already
/// removed, so each preflight waits for the one before it.
public final class HandDeckPreflight: @unchecked Sendable {
    private let lock = NSLock()
    private var tail: Task<Void, Never>?

    public init() {}

    public func clearLabel(forHelpers helperLabels: [String], home: String, uid: uid_t, runner: CommandRunner,
                           fs: HandDeckFS) async -> HandDeckRetireOutcome? {
        let run: Task<HandDeckRetireOutcome?, Never> = lock.withLock {
            let previous = tail
            let run = Task {
                await previous?.value
                return await HandDeckAgent.clearLabel(forHelpers: helperLabels, home: home, uid: uid, runner: runner, fs: fs)
            }
            tail = Task { _ = await run.value }
            return run
        }
        return await run.value
    }
}
