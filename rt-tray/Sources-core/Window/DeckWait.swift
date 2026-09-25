import Foundation

public enum DeckProbeResult: Equatable, Sendable {
    case healthy(pid: String)
    case answered(status: Int)
    case unreachable(String)
}

public enum DeckHealth {
    public static let url = "https://deck.mattstack/healthz"

    /// portless answers for deck.mattstack whether or not deck is listening,
    /// so a status alone never means deck is up; only deck's own /healthz
    /// sets x-deck-pid.
    public static func classify(status: Int, deckPid: String?) -> DeckProbeResult {
        let pid = deckPid?.trimmingCharacters(in: .whitespaces) ?? ""
        guard status == 200, !pid.isEmpty else { return .answered(status: status) }
        return .healthy(pid: pid)
    }
}

public enum DeckWaitPhase: Equatable, Sendable {
    case waiting
    case ready
    case unreachable(reason: String)
}

public enum DeckWaitTuning {
    public static let deadline: TimeInterval = 90
    public static let pollInterval: TimeInterval = 1
    public static let probeTimeout: TimeInterval = 2
    /// Deck builds /api/apps by health-probing every app, and URLSession's
    /// default request timeout is 60s; one late poll may add this much.
    public static let catalogTimeout: TimeInterval = 8
}

public struct DeckWaitDeps: Sendable {
    public let probe: @Sendable () async -> DeckProbeResult
    /// Given the pid of the deck that just answered /healthz, true once a
    /// fresh catalog from that deck is loaded; a cache copy does not count.
    public let loadCatalog: @Sendable (String) async -> Bool
    public let diagnoseAgent: @Sendable () async -> String
    public let now: @Sendable () -> TimeInterval
    public let sleep: @Sendable (TimeInterval) async -> Void

    public init(probe: @escaping @Sendable () async -> DeckProbeResult,
                loadCatalog: @escaping @Sendable (String) async -> Bool,
                diagnoseAgent: @escaping @Sendable () async -> String,
                now: @escaping @Sendable () -> TimeInterval,
                sleep: @escaping @Sendable (TimeInterval) async -> Void) {
        self.probe = probe
        self.loadCatalog = loadCatalog
        self.diagnoseAgent = diagnoseAgent
        self.now = now
        self.sleep = sleep
    }
}

public enum DeckWait {
    /// The deadline is read from the clock after every probe, never counted
    /// in polls: a probe can take its whole timeout. A cancelled wait
    /// returns `.waiting` and the caller drops it.
    public static func run(deadline: TimeInterval = DeckWaitTuning.deadline,
                           pollInterval: TimeInterval = DeckWaitTuning.pollInterval,
                           deps: DeckWaitDeps) async -> DeckWaitPhase {
        let start = deps.now()
        while !Task.isCancelled {
            let probe = await deps.probe()
            if case .healthy(let pid) = probe, await deps.loadCatalog(pid) { return .ready }
            if deps.now() - start >= deadline {
                let agent = await deps.diagnoseAgent()
                return .unreachable(reason: reason(agent: agent, lastProbe: probe))
            }
            await deps.sleep(pollInterval)
        }
        return .waiting
    }

    public static func reason(agent: String, lastProbe: DeckProbeResult) -> String {
        switch lastProbe {
        case .healthy(let pid):
            return "Deck is running (pid \(pid)), but its app list (/api/apps) did not load."
        case .answered(let status):
            return "\(agent) Requests to deck.mattstack got HTTP \(status) instead of deck."
        case .unreachable(let error):
            return "\(agent) Requests to deck.mattstack got no answer (\(error))."
        }
    }
}

public enum SplashContent: Equatable, Sendable {
    case mark
    case markWithSpinner
    case unreachable(reason: String)
    case dismiss
}

public enum SplashPresentation {
    public static func content(animationDone: Bool, phase: DeckWaitPhase) -> SplashContent {
        switch phase {
        case .unreachable(let reason): return .unreachable(reason: reason)
        case .ready: return animationDone ? .dismiss : .mark
        case .waiting: return animationDone ? .markWithSpinner : .mark
        }
    }
}
