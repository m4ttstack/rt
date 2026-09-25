import Foundation

public enum AgentRole: Equatable, Sendable {
    case daemon, deck, other

    public static func of(_ agent: AgentPlist, daemonLabel: String) -> AgentRole {
        if agent.label == daemonLabel { return .daemon }
        return agent.bundleProgram == "Contents/Helpers/deck" ? .deck : .other
    }
}

public struct LaunchAgentOutcome: Equatable, Sendable {
    public let label: String
    public let action: AgentPlistRefreshAction
    public let before: AgentRegistration
    public let reregistered: Bool?
    public let registerOk: Bool
    public let after: AgentRegistration

    public init(label: String, action: AgentPlistRefreshAction, before: AgentRegistration,
                reregistered: Bool?, registerOk: Bool, after: AgentRegistration) {
        self.label = label; self.action = action; self.before = before
        self.reregistered = reregistered; self.registerOk = registerOk; self.after = after
    }
}

public struct LaunchRegistration: Equatable, Sendable {
    /// RunAtLoad already started these on the current bundle.
    public let registeredThisLaunch: Set<String>
    public let pendingHashes: [String: String]

    public init(registeredThisLaunch: Set<String>, pendingHashes: [String: String]) {
        self.registeredThisLaunch = registeredThisLaunch; self.pendingHashes = pendingHashes
    }
}

public struct VersionChangeProgress: Equatable, Sendable {
    public let change: VersionChange
    public let failedRegisters: [String]
    public let failedKickstarts: [String]

    public init(change: VersionChange, failedRegisters: [String], failedKickstarts: [String]) {
        self.change = change; self.failedRegisters = failedRegisters; self.failedKickstarts = failedKickstarts
    }
}

public struct LaunchRecordPlan: Equatable, Sendable {
    public let hashes: [String: String]
    public let heldHashes: [String]
    /// Only a changed version is recorded here; handleVersionChange records
    /// an unchanged or first-launch version on the spot.
    public let recordVersion: Bool

    public init(hashes: [String: String], heldHashes: [String], recordVersion: Bool) {
        self.hashes = hashes; self.heldHashes = heldHashes; self.recordVersion = recordVersion
    }
}

public enum LaunchRecording {
    /// A failed re-register may have left the old job in place, so it does
    /// not count as bootstrapped even when the pass after it registers.
    public static func summarize(_ outcomes: [LaunchAgentOutcome]) -> LaunchRegistration {
        var fresh: Set<String> = []
        var pending: [String: String] = [:]
        for outcome in outcomes {
            let registeredNow = outcome.registerOk && outcome.after == .enabled
            if outcome.reregistered == true || (outcome.before == .notRegistered && registeredNow) {
                fresh.insert(outcome.label)
            }
            switch outcome.action {
            case .reregister(let hash) where outcome.reregistered == true:
                pending[outcome.label] = hash
            case .recordAfterRegister(let hash)
                where AgentPlistRefresh.shouldRecordAfterRegister(ok: outcome.registerOk, registration: outcome.after):
                pending[outcome.label] = hash
            default:
                break
            }
        }
        return LaunchRegistration(registeredThisLaunch: fresh, pendingHashes: pending)
    }

    /// kickstart -k on a job bootstrapped this launch kills a process that
    /// already runs the new bundle and can wait out its whole ExitTimeOut.
    public static func kickstartLabels(_ labels: [String], registeredThisLaunch: Set<String>) -> [String] {
        labels.filter { !registeredThisLaunch.contains($0) }
    }

    /// A hash recorded for an agent that never answered would stop the next
    /// launch from re-registering it.
    public static func plan(registration: LaunchRegistration, progress: VersionChangeProgress,
                            report: LaunchSettleReport) -> LaunchRecordPlan {
        var hashes: [String: String] = [:]
        var held: [String] = []
        for (label, hash) in registration.pendingHashes {
            if report.answered[label] ?? true { hashes[label] = hash } else { held.append(label) }
        }
        guard case .changed = progress.change else {
            return LaunchRecordPlan(hashes: hashes, heldHashes: held.sorted(), recordVersion: false)
        }
        let recordVersion = progress.failedRegisters.isEmpty
            && Set(progress.failedKickstarts).isSubset(of: report.healed)
            && report.answered.values.allSatisfy { $0 }
        return LaunchRecordPlan(hashes: hashes, heldHashes: held.sorted(), recordVersion: recordVersion)
    }

    /// A Sparkle update swaps `Contents/Helpers/<app>` at the same path, so
    /// deck's sweep finds every served plist unchanged and never restarts the
    /// apps still running the deleted binary.
    public static func restartsServedApps(progress: VersionChangeProgress, report: LaunchSettleReport,
                                          deckLabel: String?) -> Bool {
        guard case .changed = progress.change, let deckLabel else { return false }
        return report.answered[deckLabel] == true
    }
}
