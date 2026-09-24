import Foundation

public struct FlavorTeardownAgent: Equatable, Sendable {
    public let label: String
    public let status: String
    public init(label: String, status: String) { self.label = label; self.status = status }
}

/// What an app gives up when it retires: the steps run against
/// SMAppService in the app, and against fakes in the checks.
public protocol FlavorTeardownSteps: Sendable {
    /// Stops and unregisters the daemon agent through the lifecycle gate;
    /// answers its status afterwards.
    func stopDaemon() async -> String
    /// Unregisters every agent the bundle ships; answers each one's status.
    func unregisterAgents() async -> [FlavorTeardownAgent]
    func retireHandDeck() async -> String
    func unregisterLoginItem() async -> (status: String, error: String?)
}

public struct FlavorTeardownResult: Equatable, Sendable {
    public let daemon: String
    public let agents: [FlavorTeardownAgent]
    public let handDeck: String
    public let loginItem: String
    public let error: String?

    /// Ground truth, not intention: nothing this app registers may still be
    /// enabled, or it loads at the next login beside the active app's jobs.
    public var retired: Bool {
        daemon != "enabled" && loginItem != "enabled" && agents.allSatisfy { $0.status != "enabled" }
    }

    public var replyJSON: String {
        var body: [String: Any] = [
            "ok": retired,
            "daemon": daemon,
            "agents": Dictionary(agents.map { ($0.label, $0.status) }, uniquingKeysWith: { _, last in last }),
            "handDeck": handDeck,
            "loginItem": loginItem,
        ]
        if let error { body["error"] = error }
        let data = (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}

/// The one retire path, shared by POST /flavor/retire (the other app taking
/// over) and a login item standing down. The login item goes last so an app
/// interrupted mid-teardown still comes back at login to finish it.
public enum FlavorTeardown {
    public static func run(_ steps: FlavorTeardownSteps) async -> FlavorTeardownResult {
        let daemon = await steps.stopDaemon()
        let agents = await steps.unregisterAgents()
        let handDeck = await steps.retireHandDeck()
        let login = await steps.unregisterLoginItem()
        return FlavorTeardownResult(daemon: daemon, agents: agents, handDeck: handDeck,
                                    loginItem: login.status, error: login.error)
    }
}
