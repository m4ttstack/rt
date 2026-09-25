import Foundation
import MattstackCore

private actor StepLog {
    var steps: [String] = []
    func add(_ s: String) { steps.append(s) }
}

private func state(_ label: String, bundle: String?, recorded: String?,
                   _ registration: AgentRegistration) -> AgentPlistState {
    AgentPlistState(label: label, bundleHash: bundle, recordedHash: recorded, registration: registration)
}

let agentPlistRefreshChecks: [Check] = [
    Check("plist refresh: an unchanged plist is left alone, whatever its registration") { c in
        for reg in [AgentRegistration.enabled, .notRegistered, .requiresApproval, .notFound] {
            c.expectEqual(AgentPlistRefresh.decide(state("d", bundle: "h1", recorded: "h1", reg)), .leave, "\(reg)")
        }
    },
    Check("plist refresh: a changed plist on an enabled agent is re-registered") { c in
        c.expectEqual(AgentPlistRefresh.decide(state("d", bundle: "h2", recorded: "h1", .enabled)), .reregister(hash: "h2"))
    },
    Check("plist refresh: nothing recorded on an enabled agent is re-registered, since launchd may hold any older plist") { c in
        c.expectEqual(AgentPlistRefresh.decide(state("d", bundle: "h2", recorded: nil, .enabled)), .reregister(hash: "h2"))
    },
    Check("plist refresh: an agent not registered is recorded only after the launch registration succeeds") { c in
        c.expectEqual(AgentPlistRefresh.decide(state("d", bundle: "h2", recorded: "h1", .notRegistered)),
                      .recordAfterRegister(hash: "h2"))
        c.expectEqual(AgentPlistRefresh.decide(state("d", bundle: "h2", recorded: nil, .notRegistered)),
                      .recordAfterRegister(hash: "h2"))
    },
    Check("plist refresh: an agent awaiting approval or unknown to SMAppService is left unrecorded") { c in
        c.expectEqual(AgentPlistRefresh.decide(state("d", bundle: "h2", recorded: "h1", .requiresApproval)), .leave)
        c.expectEqual(AgentPlistRefresh.decide(state("d", bundle: "h2", recorded: nil, .notFound)), .leave)
    },
    Check("plist refresh: an unreadable bundle plist is never acted on") { c in
        c.expectEqual(AgentPlistRefresh.decide(state("d", bundle: nil, recorded: "h1", .enabled)), .leave)
    },
    Check("plist refresh: the plan keeps each agent's own decision, in order") { c in
        let plan = AgentPlistRefresh.plan([
            state("com.mattstack.daemon", bundle: "a2", recorded: "a1", .enabled),
            state("com.mattstack.deck", bundle: "b1", recorded: "b1", .enabled),
        ])
        c.expectEqual(plan.map(\.label), ["com.mattstack.daemon", "com.mattstack.deck"])
        c.expectEqual(plan.map(\.action), [.reregister(hash: "a2"), .leave])
    },
    Check("plist refresh: the record key is per label") { c in
        c.expect(AgentPlistRefresh.storeKey(label: "com.mattstack.daemon")
                 != AgentPlistRefresh.storeKey(label: "com.mattstack.daemon.dev"))
    },
    Check("plist refresh: the hash is stable and tracks content") { c in
        let a = AgentPlistRefresh.hash(Data("<plist>a</plist>".utf8))
        c.expectEqual(a, AgentPlistRefresh.hash(Data("<plist>a</plist>".utf8)))
        c.expect(a != AgentPlistRefresh.hash(Data("<plist>b</plist>".utf8)))
        c.expectEqual(a.count, 64)
    },
    Check("plist refresh: a registration that ends enabled is what gets recorded") { c in
        c.expect(AgentPlistRefresh.shouldRecordAfterRegister(ok: true, registration: .enabled))
        c.expect(!AgentPlistRefresh.shouldRecordAfterRegister(ok: true, registration: .requiresApproval))
        c.expect(!AgentPlistRefresh.shouldRecordAfterRegister(ok: false, registration: .enabled))
    },
    Check("reregister: unregister, settle, register, then start once") { c in
        let log = StepLog()
        let outcome = await AgentReregister.run(
            unregister: { await log.add("unregister"); return true },
            settle: { await log.add("settle") },
            register: { await log.add("register"); return true },
            beforeRetry: { await log.add("pause") },
            start: { await log.add("start") })
        c.expectEqual(outcome, .reregistered)
        c.expectEqual(await log.steps, ["unregister", "settle", "register", "start"])
    },
    Check("reregister: a failed register is retried once, then started") { c in
        let log = StepLog()
        let attempts = StepLog()
        let outcome = await AgentReregister.run(
            unregister: { await log.add("unregister"); return true },
            settle: { await log.add("settle") },
            register: {
                await log.add("register")
                await attempts.add("x")
                return await attempts.steps.count > 1
            },
            beforeRetry: { await log.add("pause") },
            start: { await log.add("start") })
        c.expectEqual(outcome, .reregisteredOnRetry)
        c.expectEqual(await log.steps, ["unregister", "settle", "register", "pause", "register", "start"])
    },
    Check("reregister: a register that fails twice reports it and never starts") { c in
        let log = StepLog()
        let outcome = await AgentReregister.run(
            unregister: { await log.add("unregister"); return true },
            settle: { await log.add("settle") },
            register: { await log.add("register"); return false },
            beforeRetry: { await log.add("pause") },
            start: { await log.add("start") })
        c.expectEqual(outcome, .registerFailed)
        c.expectEqual(await log.steps, ["unregister", "settle", "register", "pause", "register"])
        c.expect(!outcome.succeeded)
    },
    Check("reregister: a failed unregister never registers over the still-registered job") { c in
        let log = StepLog()
        let outcome = await AgentReregister.run(
            unregister: { await log.add("unregister"); return false },
            settle: { await log.add("settle") },
            register: { await log.add("register"); return true },
            beforeRetry: { await log.add("pause") },
            start: { await log.add("start") })
        c.expectEqual(outcome, .unregisterFailed)
        c.expectEqual(await log.steps, ["unregister"])
        c.expect(!outcome.succeeded)
    },
    Check("reregister: the settle is a real gap and shorter than the retry pause") { c in
        c.expect(AgentReregister.settleNanoseconds >= 500_000_000)
        c.expect(AgentReregister.settleNanoseconds < AgentReregister.retryPauseNanoseconds)
    },
    Check("reregister: both success outcomes count as succeeded") { c in
        c.expect(AgentReregisterOutcome.reregistered.succeeded)
        c.expect(AgentReregisterOutcome.reregisteredOnRetry.succeeded)
    },
]
