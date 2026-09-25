import Foundation

public enum SpawnHealVerdict: Equatable, Sendable {
    case heal(reason: String)
    case leave(reason: String)
}

/// Only a job launchd refused to spawn gets the unregister/register cycle:
/// SMAppService's `enabled` is BTM's view, not launchd's, and a job that is
/// running or crashed on its own gets nothing a re-register fixes.
public enum AgentSpawnHealth {
    public static let exConfig = 78

    public static func decide(registration: AgentRegistration, lookup: LaunchdJobLookup,
                              alreadyAttempted: Bool) -> SpawnHealVerdict {
        guard registration == .enabled else { return .leave(reason: "registration is \(registration)") }
        guard !alreadyAttempted else { return .leave(reason: "already healed this launch") }
        switch lookup {
        case .unknown(let detail):
            return .leave(reason: "launchd state unknown: \(detail)")
        case .notLoaded:
            return .heal(reason: "enabled but launchd holds no job")
        case .loaded(let job):
            if job.pid != nil { return .leave(reason: "job is running") }
            if job.lastExitCode == exConfig { return .heal(reason: "last exit 78 (EX_CONFIG)") }
            if job.jobState == "spawn failed" { return .heal(reason: "job state spawn failed") }
            if job.properties.contains("needs LWCR update") { return .heal(reason: "needs LWCR update") }
            return .leave(reason: "not a refused spawn")
        }
    }
}

/// One heal per label per process: a heal that does not take must never
/// become a loop fighting launchd.
public final class SpawnHealLatch: @unchecked Sendable {
    private let lock = NSLock()
    private var claimed: Set<String> = []

    public init() {}

    public func attempted(_ label: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return claimed.contains(label)
    }

    public func claim(_ label: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return claimed.insert(label).inserted
    }
}
