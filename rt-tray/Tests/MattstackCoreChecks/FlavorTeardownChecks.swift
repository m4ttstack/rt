import Foundation
import MattstackCore

private actor TeardownLog {
    var steps: [String] = []
    func add(_ s: String) { steps.append(s) }
}

private struct FakeTeardown: FlavorTeardownSteps {
    let log: TeardownLog
    var agentsAfter: [FlavorTeardownAgent] = [
        .init(label: "com.mattstack.daemon", status: "notRegistered"),
        .init(label: "com.mattstack.deck", status: "notRegistered"),
    ]
    var loginAfter = "notRegistered"

    func stopDaemon() async -> String { await log.add("daemon"); return "notRegistered" }
    func unregisterAgents() async -> [FlavorTeardownAgent] { await log.add("agents"); return agentsAfter }
    func retireHandDeck() async -> String { await log.add("handDeck"); return "absent" }
    func unregisterLoginItem() async -> (status: String, error: String?) { await log.add("loginItem"); return (loginAfter, nil) }
}

let flavorTeardownChecks: [Check] = [
    Check("teardown: daemon, every agent, the hand deck agent, then the login item") { c in
        let log = TeardownLog()
        let result = await FlavorTeardown.run(FakeTeardown(log: log))
        c.expectEqual(await log.steps, ["daemon", "agents", "handDeck", "loginItem"])
        c.expect(result.retired, "everything unregistered is retired")
    },
    Check("teardown: a deck agent still enabled is not retired, and the reply names it") { c in
        var fake = FakeTeardown(log: TeardownLog())
        fake.agentsAfter = [.init(label: "com.mattstack.daemon", status: "notRegistered"),
                            .init(label: "com.mattstack.deck", status: "enabled")]
        let result = await FlavorTeardown.run(fake)
        c.expect(!result.retired, "a registered deck agent loads at next login next to the active deck")
        c.expect(result.replyJSON.contains("\"com.mattstack.deck\":\"enabled\""), result.replyJSON)
    },
    Check("teardown: a login item still enabled is not retired") { c in
        var fake = FakeTeardown(log: TeardownLog())
        fake.loginAfter = "enabled"
        c.expect(!(await FlavorTeardown.run(fake)).retired)
    },
]
