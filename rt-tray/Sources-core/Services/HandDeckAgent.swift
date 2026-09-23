import Foundation

/// Retires a hand-installed deck LaunchAgent (`deck setup` writes one into
/// ~/Library/LaunchAgents) so the bundle's SMAppService deck helper is deck's
/// only supervisor. Mirrors rt's lib/deck-hand-agent.ts.
///
/// The prod helper reuses the label `com.mattstack.deck`, so only a job whose
/// launchd `path` is the ~/Library/LaunchAgents plist is booted out; an
/// SMAppService job prints `path = (submitted by smd.<pid>)` instead.
public enum HandDeckRetireOutcome: Equatable, Sendable {
    case absent
    case retired(bootedOut: Bool, archivedTo: String)
    case failed(String)

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
        if case .retired(bootedOut: true, _) = self { return true }
        return false
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

    public static func blockedNotice(for outcome: HandDeckRetireOutcome, home: String, uid: uid_t) -> HandDeckBlockedNotice? {
        guard case .failed(let reason) = outcome else { return nil }
        let retired = retiredPath(home: home)
        let dir = (retired as NSString).deletingLastPathComponent
        return HandDeckBlockedNotice(
            summary: "A hand-installed deck agent is blocking the deck helper.",
            reason: reason,
            fixCommand: """
                launchctl bootout gui/\(uid)/\(label)
                mkdir -p '\(dir)' && mv -n '\(plistPath(home: home))' '\(retired)'
                """)
    }

    public static func retire(home: String, uid: uid_t, runner: CommandRunner, fs: HandDeckFS,
                              now: () -> Date = Date.init) async -> HandDeckRetireOutcome {
        let plist = plistPath(home: home)
        guard fs.exists(plist) else { return .absent }

        let target = "gui/\(uid)/\(label)"
        let print = await runner.run(launchctlPath, ["print", target])
        var bootedOut = false
        let loadedFromPlist = print.ok && print.stdout.split(separator: "\n")
            .contains { $0.trimmingCharacters(in: .whitespaces) == "path = \(plist)" }
        if loadedFromPlist {
            let bootout = await runner.run(launchctlPath, ["bootout", target])
            guard bootout.ok else {
                return .failed("bootout \(target) exited \(bootout.exitCode): \((bootout.stderr + bootout.stdout).trimmingCharacters(in: .whitespacesAndNewlines))")
            }
            bootedOut = true
        }

        let base = retiredPath(home: home)
        let archivedTo = fs.exists(base) ? "\(base).\(Int64(now().timeIntervalSince1970 * 1000))" : base
        do {
            try fs.createDirectory((base as NSString).deletingLastPathComponent)
            try fs.move(plist, archivedTo)
        } catch {
            return .failed("could not archive \(plist): \(error.localizedDescription)")
        }
        return .retired(bootedOut: bootedOut, archivedTo: archivedTo)
    }
}
