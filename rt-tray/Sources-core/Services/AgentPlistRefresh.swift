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
/// be left unregistered by the refresh that meant to renew it.
public enum AgentReregister {
    /// An unregistered job can take up to its ExitTimeOut to leave launchd,
    /// and a register racing that exit fails.
    public static let retryPauseNanoseconds: UInt64 = 2_000_000_000

    public static func run(unregister: () async -> Bool, register: () async -> Bool,
                           beforeRetry: () async -> Void) async -> AgentReregisterOutcome {
        guard await unregister() else { return .unregisterFailed }
        if await register() { return .reregistered }
        await beforeRetry()
        return await register() ? .reregisteredOnRetry : .registerFailed
    }
}
