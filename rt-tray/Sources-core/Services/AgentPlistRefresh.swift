import Foundation
import CryptoKit

public enum AgentRegistration: Equatable, Sendable {
    case enabled, notRegistered, requiresApproval, notFound
}

public struct AgentPlistState: Equatable, Sendable {
    public let label: String
    public let bundleHash: String?
    public let recordedHash: String?
    public let registration: AgentRegistration
    public init(label: String, bundleHash: String?, recordedHash: String?, registration: AgentRegistration) {
        self.label = label; self.bundleHash = bundleHash
        self.recordedHash = recordedHash; self.registration = registration
    }
}

public enum AgentPlistRefreshAction: Equatable, Sendable {
    case leave
    case reregister(hash: String)
    case recordAfterRegister(hash: String)
}

public struct AgentPlistPlanEntry: Equatable, Sendable {
    public let label: String
    public let action: AgentPlistRefreshAction
}

/// launchd reads an agent plist only at bootstrap, and registering an agent
/// that is already enabled is a no-op, so a plist an app update changed never
/// reaches an existing install unless the agent is unregistered first.
public enum AgentPlistRefresh {
    public static func storeKey(label: String) -> String { "MSAgentPlistHash." + label }

    public static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// An agent awaiting approval stays unrecorded so the launch after the
    /// user enables it still sees the mismatch and re-registers it.
    public static func decide(_ state: AgentPlistState) -> AgentPlistRefreshAction {
        guard let bundle = state.bundleHash, bundle != state.recordedHash else { return .leave }
        switch state.registration {
        case .enabled: return .reregister(hash: bundle)
        case .notRegistered: return .recordAfterRegister(hash: bundle)
        case .requiresApproval, .notFound: return .leave
        }
    }

    public static func plan(_ states: [AgentPlistState]) -> [AgentPlistPlanEntry] {
        states.map { AgentPlistPlanEntry(label: $0.label, action: decide($0)) }
    }

    public static func shouldRecordAfterRegister(ok: Bool, registration: AgentRegistration) -> Bool {
        ok && registration == .enabled
    }
}

public enum AgentReregisterOutcome: Equatable, Sendable {
    case reregistered, reregisteredOnRetry, unregisterFailed, registerFailed
    public var succeeded: Bool { self == .reregistered || self == .reregisteredOnRetry }
}

/// A failed unregister leaves the job registered as it was, so nothing is
/// registered over it. A failed register is retried once: the agent must not
/// be left unregistered by the refresh that meant to renew it. The job is
/// started only once a register has landed.
public enum AgentReregister {
    /// The sequence that recovered a job launchd would not spawn had at least
    /// 500ms between unregister and register; the one that left it so had none.
    /// It is timed from the drain, since unregister returns before the reap.
    public static let settleNanoseconds: UInt64 = 1_000_000_000
    /// A register racing the old job's exit fails.
    public static let retryPauseNanoseconds: UInt64 = 2_000_000_000

    public static func run(unregister: () async -> Bool, drain: () async -> Void, settle: () async -> Void,
                           register: () async -> Bool, beforeRetry: () async -> Void,
                           start: () async -> Void) async -> AgentReregisterOutcome {
        guard await unregister() else { return .unregisterFailed }
        await drain()
        await settle()
        if await register() {
            await start()
            return .reregistered
        }
        await beforeRetry()
        guard await register() else { return .registerFailed }
        await start()
        return .reregisteredOnRetry
    }
}

public enum AgentDrainOutcome: Equatable, Sendable {
    case drained
    case stillLoaded
    case unknown(String)
}

/// SMAppService's synchronous unregister returns before launchd reaps the
/// old process, so the re-register waits for launchd to drop the job.
public enum AgentDrain {
    /// Past both agent plists' ExitTimeOut, when launchd SIGKILLs the job.
    public static let deadline: TimeInterval = 35
    public static let pollInterval: TimeInterval = 0.25

    public static func wait(deadline: TimeInterval = AgentDrain.deadline,
                            pollInterval: TimeInterval = AgentDrain.pollInterval,
                            lookup: () async -> LaunchdJobLookup, now: () -> TimeInterval,
                            sleep: (TimeInterval) async -> Void) async -> AgentDrainOutcome {
        let start = now()
        while true {
            switch await lookup() {
            case .notLoaded:
                return .drained
            case .unknown(let detail):
                return .unknown(detail)
            case .loaded:
                if now() - start >= deadline { return .stillLoaded }
                await sleep(pollInterval)
            }
        }
    }
}

/// A register that bootstrapped the job lets RunAtLoad start it, and -k
/// would kill that process; a job registered before may be exited or hung.
public enum StartAfterRegister {
    public static func killsFirst(registeredBefore: AgentRegistration) -> Bool {
        registeredBefore != .notRegistered
    }
}
