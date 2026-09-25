import Foundation

public struct AnswerBudget: Equatable, Sendable {
    public let attempts: Int
    public let intervalNanoseconds: UInt64

    public init(attempts: Int, intervalNanoseconds: UInt64) {
        self.attempts = attempts; self.intervalNanoseconds = intervalNanoseconds
    }

    public static let daemon = AnswerBudget(attempts: 30, intervalNanoseconds: 500_000_000)
    /// Each deck probe spawns its CLI, so it polls half as often.
    public static let deck = AnswerBudget(attempts: 30, intervalNanoseconds: 1_000_000_000)
}

public enum AgentAnswerWait {
    public static func wait(_ budget: AnswerBudget, sleep: (UInt64) async -> Void,
                            probe: () async -> Bool) async -> Bool {
        let attempts = max(budget.attempts, 1)
        for attempt in 1...attempts {
            if await probe() { return true }
            if attempt < attempts { await sleep(budget.intervalNanoseconds) }
        }
        return false
    }
}

public struct LaunchAgentProbe: Sendable {
    public let label: String
    public let budget: AnswerBudget
    public let answers: @Sendable () async -> Bool
    public let registration: @Sendable () async -> AgentRegistration
    public let lookup: @Sendable () async -> LaunchdJobLookup
    public let heal: @Sendable () async -> Bool

    public init(label: String, budget: AnswerBudget, answers: @escaping @Sendable () async -> Bool,
                registration: @escaping @Sendable () async -> AgentRegistration,
                lookup: @escaping @Sendable () async -> LaunchdJobLookup,
                heal: @escaping @Sendable () async -> Bool) {
        self.label = label; self.budget = budget; self.answers = answers
        self.registration = registration; self.lookup = lookup; self.heal = heal
    }
}

public struct LaunchSettleReport: Equatable, Sendable {
    public var answered: [String: Bool]
    /// Agents a heal re-registered, whether or not they answered after it.
    public var healed: Set<String>

    public init(answered: [String: Bool] = [:], healed: Set<String> = []) {
        self.answered = answered; self.healed = healed
    }
}

public enum LaunchSettleEvent: Equatable, Sendable {
    case answered(label: String)
    case left(label: String, reason: String)
    case healed(label: String, reason: String, reregistered: Bool, answered: Bool)
}

/// The launch's only spawn-health heal: an agent that stays silent for its
/// whole budget, and that launchd refused to spawn, gets one re-register and
/// one more budget. The latch, not this call, is what bounds it per launch.
public enum LaunchSettle {
    private struct Outcome: Sendable {
        let label: String
        let answered: Bool
        let healed: Bool
    }

    public static func run(_ probes: [LaunchAgentProbe], latch: SpawnHealLatch,
                           sleep: @escaping @Sendable (UInt64) async -> Void,
                           observer: (@Sendable (LaunchSettleEvent) -> Void)? = nil) async -> LaunchSettleReport {
        await withTaskGroup(of: Outcome.self) { group in
            for probe in probes {
                group.addTask { await settle(probe, latch: latch, sleep: sleep, observer: observer) }
            }
            var report = LaunchSettleReport()
            for await outcome in group {
                report.answered[outcome.label] = outcome.answered
                if outcome.healed { report.healed.insert(outcome.label) }
            }
            return report
        }
    }

    private static func settle(_ probe: LaunchAgentProbe, latch: SpawnHealLatch,
                               sleep: @escaping @Sendable (UInt64) async -> Void,
                               observer: (@Sendable (LaunchSettleEvent) -> Void)?) async -> Outcome {
        if await AgentAnswerWait.wait(probe.budget, sleep: sleep, probe: probe.answers) {
            observer?(.answered(label: probe.label))
            return Outcome(label: probe.label, answered: true, healed: false)
        }
        let registration = await probe.registration()
        let lookup = await probe.lookup()
        let verdict = AgentSpawnHealth.decide(registration: registration, lookup: lookup,
                                              alreadyAttempted: latch.attempted(probe.label))
        guard case .heal(let reason) = verdict, latch.claim(probe.label) else {
            let leftReason: String
            if case .leave(let why) = verdict { leftReason = why } else { leftReason = "already healed this launch" }
            observer?(.left(label: probe.label, reason: leftReason))
            return Outcome(label: probe.label, answered: false, healed: false)
        }
        let reregistered = await probe.heal()
        var answered = false
        if reregistered {
            answered = await AgentAnswerWait.wait(probe.budget, sleep: sleep, probe: probe.answers)
        }
        observer?(.healed(label: probe.label, reason: reason, reregistered: reregistered, answered: answered))
        return Outcome(label: probe.label, answered: answered, healed: reregistered)
    }
}
