import Foundation
import MattstackCore

private func doneFixture(plans: [Plan], answers: [String: (Int32, String)] = [:]) async -> (DoneModel, ReadinessModel, ScriptedRt, FakePlans) {
    let rt = ScriptedRt()
    rt.answers = answers
    let fake = FakePlans(plans)
    let readiness = await MainActor.run { ReadinessModel(plans: fake, permissions: FakePermissions(), ticker: FakeTicker()) }
    let model = await MainActor.run { DoneModel(readiness: readiness, waivers: WaiverClient(rt: rt, readiness: readiness)) }
    return (model, readiness, rt, fake)
}

/// A plan source the check releases by hand, so a post-install check can be
/// observed while it is still in flight.
final class HeldPlans: PlanSource, @unchecked Sendable {
    private let lock = NSLock()
    private var waiters: [CheckedContinuation<Plan, Error>] = []
    private var fetchCount = 0
    var fetches: Int { lock.lock(); defer { lock.unlock() }; return fetchCount }
    func fetchPlan() async throws -> Plan {
        try await withCheckedThrowingContinuation { cont in
            lock.lock(); fetchCount += 1; waiters.append(cont); lock.unlock()
        }
    }
    func release(_ plan: Plan) {
        lock.lock(); let ws = waiters; waiters = []; lock.unlock()
        ws.forEach { $0.resume(returning: plan) }
    }
}

private func waitUntil(_ cond: @escaping @MainActor () -> Bool, tries: Int = 200) async {
    for _ in 0..<tries {
        if await MainActor.run(body: cond) { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
}

let doneModelChecks: [Check] = [
    Check("a post-install check that never answers fails open once the watchdog fires, with the timeout shown") { c in
        let held = HeldPlans()
        let readiness = await MainActor.run { ReadinessModel(plans: held, permissions: FakePermissions(), ticker: FakeTicker()) }
        let m = await MainActor.run { DoneModel(readiness: readiness, waivers: WaiverClient(rt: ScriptedRt(), readiness: readiness), checkTimeout: 0.05) }
        let run = Task { await m.checkPostInstall() }
        await waitUntil { m.refreshFailed }
        await MainActor.run {
            c.expectEqual(m.refreshFailed, true, "a hung rt must not hold Finish shut")
            c.expectEqual(m.finishEnabled, true)
            c.expect(m.refreshError?.contains("did not answer") == true)
        }
        held.release(makeManualPlan(extensionStatus: .needsYou))
        await run.value
        await MainActor.run {
            c.expectEqual(m.hasCheckedSincePostInstall, true, "a late answer is still the truth")
            c.expectEqual(m.finishEnabled, false)
            c.expectEqual(m.blockedRows.map(\.id), ["tool.fast-browser-extension"])
        }
    },
    Check("a second arrival at Done re-checks from scratch: the previous run's rows are not shown as fresh while the new check is in flight") { c in
        let held = HeldPlans()
        let readiness = await MainActor.run { ReadinessModel(plans: held, permissions: FakePermissions(), ticker: FakeTicker()) }
        let m = await MainActor.run { DoneModel(readiness: readiness, waivers: WaiverClient(rt: ScriptedRt(), readiness: readiness)) }
        let first = Task { await m.checkPostInstall() }
        await waitUntil { held.fetches == 1 }
        held.release(makeManualPlan(extensionStatus: .ready))
        await first.value
        await MainActor.run {
            c.expectEqual(m.hasCheckedSincePostInstall, true)
            c.expectEqual(m.finishEnabled, true)
        }
        let second = Task { await m.checkPostInstall() }
        await waitUntil { held.fetches == 2 }
        await MainActor.run {
            c.expectEqual(m.hasCheckedSincePostInstall, false, "entering the check resets the flag")
            c.expectEqual(m.finishEnabled, false, "in flight reads closed, not the last run's answer")
            c.expectEqual(m.blockedRows.map(\.id), [])
        }
        held.release(makeManualPlan(extensionStatus: .needsYou))
        await second.value
        await MainActor.run {
            c.expectEqual(m.blockedRows.map(\.id), ["tool.fast-browser-extension"])
            c.expectEqual(m.finishEnabled, false)
        }
    },
    Check("finish gate copy is pinned byte for byte") { c in
        c.expectEqual(FinishGate.beforeYouFinishTitle, "Before you finish")
        c.expectEqual(FinishGate.skipSheetTitle, "Skip the Fast Browser extension?")
        c.expectEqual(FinishGate.skipSheetBody, "Without the Fast Browser extension, agents cannot capture screenshots or annotate evidence from your browser. You can load it later from Settings.")
        c.expectEqual(FinishGate.skipSheetConfirm, "Skip for now")
        c.expectEqual(FinishGate.skipSheetCancel, "Cancel")
        c.expectEqual(FinishGate.headline(blocked: 1), "One step left before you finish")
        c.expectEqual(FinishGate.headline(blocked: 2), "2 steps left before you finish")
    },
    Check("before the post-install check nothing is listed and Finish is closed; after it the blocked row is in Before you finish, not Still to do") { c in
        let (m, _, _, _) = await doneFixture(plans: [makeManualPlan(extensionStatus: .needsYou)])
        await MainActor.run {
            c.expectEqual(m.blockedRows.map(\.id), [])
            c.expectEqual(m.stillToDoRows.map(\.id), [])
            c.expectEqual(m.finishEnabled, false, "unchecked is closed, never open")
        }
        await m.checkPostInstall()
        await MainActor.run {
            c.expectEqual(m.hasCheckedSincePostInstall, true)
            c.expectEqual(m.blockedRows.map(\.id), ["tool.fast-browser-extension"])
            c.expectEqual(m.stillToDoRows.map(\.id), [], "mission-control's open-settings action never qualifies, and the blocked row is not listed twice")
            c.expectEqual(m.finishEnabled, false)
            c.expectEqual(m.headline, "One step left before you finish")
        }
    },
    Check("a failed post-install refresh fails open: the error is shown, Finish is enabled, and Try again re-checks and closes the gate on success") { c in
        final class BoomOnce: PlanSource, @unchecked Sendable {
            var n = 0
            func fetchPlan() async throws -> Plan {
                n += 1
                if n == 1 { throw RtClientError.exited(1, stderr: "boom") }
                return makeManualPlan(extensionStatus: .needsYou)
            }
        }
        let readiness = await MainActor.run { ReadinessModel(plans: BoomOnce(), permissions: FakePermissions(), ticker: FakeTicker()) }
        let m = await MainActor.run { DoneModel(readiness: readiness, waivers: WaiverClient(rt: ScriptedRt(), readiness: readiness)) }
        await MainActor.run {
            c.expectEqual(m.refreshFailed, false, "nothing has failed before the first check")
            c.expectEqual(m.finishEnabled, false, "in flight is closed")
        }
        await m.checkPostInstall()
        await MainActor.run {
            c.expectEqual(m.hasCheckedSincePostInstall, false)
            c.expectEqual(m.refreshFailed, true)
            c.expect(m.refreshError?.contains("boom") == true, "the error is what the screen shows next to Try again")
            c.expectEqual(m.finishEnabled, true, "a gate that could not be evaluated must never strand the wizard")
            c.expectEqual(m.blockedRows.map(\.id), [])
        }
        await m.retryCheck()
        await MainActor.run {
            c.expectEqual(m.refreshFailed, false)
            c.expectEqual(m.hasCheckedSincePostInstall, true)
            c.expectEqual(m.blockedRows.map(\.id), ["tool.fast-browser-extension"])
            c.expectEqual(m.finishEnabled, false, "a fresh plan that names a blocker closes the gate again")
        }
    },
    Check("no blockers after the check: Finish enabled, headline reads as installed") { c in
        let (m, _, _, _) = await doneFixture(plans: [makeManualPlan(extensionStatus: .ready)])
        await m.checkPostInstall()
        await MainActor.run {
            c.expectEqual(m.blockedRows.map(\.id), [])
            c.expectEqual(m.finishEnabled, true)
            c.expectEqual(m.headline, "Everything's working")
        }
    },
    Check("confirming Skip for now runs rt setup waive <id> --json, re-checks, and the row moves to Still to do with Finish enabled") { c in
        let (m, _, rt, plans) = await doneFixture(
            plans: [makeManualPlan(extensionStatus: .needsYou), makeManualPlan(extensionStatus: .needsYou, waived: true)],
            answers: ["setup waive tool.fast-browser-extension --json": (0, #"{"contract":1,"at":"t","ok":true,"id":"tool.fast-browser-extension","waived":["tool.fast-browser-extension"]}"#)])
        await m.checkPostInstall()
        let row = try await MainActor.run { try c.requireSome(m.blockedRows.first) }
        await MainActor.run { m.requestSkip(row) }
        await MainActor.run { c.expectEqual(m.skipTarget?.id, "tool.fast-browser-extension") }
        await m.confirmSkip()
        c.expectEqual(rt.calls.map(\.args), [["setup", "waive", "tool.fast-browser-extension", "--json"]])
        c.expectEqual(plans.fetches, 2, "confirming re-checks the plan")
        await MainActor.run {
            c.expectEqual(m.skipTarget?.id, nil, "the sheet closes on success")
            c.expectEqual(m.skipError, nil)
            c.expectEqual(m.blockedRows.map(\.id), [])
            c.expect(m.stillToDoRows.map(\.id).contains("tool.fast-browser-extension"))
            c.expectEqual(m.finishEnabled, true)
        }
    },
    Check("a waive that fails leaves the sheet up with the error and the gate closed") { c in
        let (m, _, rt, plans) = await doneFixture(
            plans: [makeManualPlan(extensionStatus: .needsYou)],
            answers: ["setup waive tool.fast-browser-extension --json": (2, #"{"contract":1,"at":"t","error":{"code":"not-finish-gated","message":"nope"}}"#)])
        await m.checkPostInstall()
        let row = try await MainActor.run { try c.requireSome(m.blockedRows.first) }
        await MainActor.run { m.requestSkip(row) }
        await m.confirmSkip()
        c.expectEqual(rt.calls.count, 1)
        c.expectEqual(plans.fetches, 1, "a failed waive does not re-check")
        await MainActor.run {
            c.expectEqual(m.skipTarget?.id, "tool.fast-browser-extension")
            c.expectEqual(m.skipError, "nope")
            c.expectEqual(m.finishEnabled, false)
        }
    },
    Check("cancel clears the sheet without running anything") { c in
        let (m, _, rt, _) = await doneFixture(plans: [makeManualPlan(extensionStatus: .needsYou)])
        await m.checkPostInstall()
        let row = try await MainActor.run { try c.requireSome(m.blockedRows.first) }
        await MainActor.run { m.requestSkip(row); m.cancelSkip() }
        await MainActor.run { c.expectEqual(m.skipTarget?.id, nil) }
        c.expectEqual(rt.calls.count, 0)
    },
    Check("WaiverClient.unwaive runs rt setup unwaive <id> --json and re-checks") { c in
        let (_, readiness, rt, plans) = await doneFixture(
            plans: [makeManualPlan(extensionStatus: .needsYou, waived: true), makeManualPlan(extensionStatus: .needsYou)],
            answers: ["setup unwaive tool.fast-browser-extension --json": (0, #"{"contract":1,"at":"t","ok":true,"id":"tool.fast-browser-extension","waived":[]}"#)])
        await readiness.load()
        let waivers = await MainActor.run { WaiverClient(rt: rt, readiness: readiness) }
        let err = await waivers.unwaive("tool.fast-browser-extension")
        c.expectEqual(err, nil)
        c.expectEqual(rt.calls.map(\.args), [["setup", "unwaive", "tool.fast-browser-extension", "--json"]])
        c.expectEqual(plans.fetches, 2)
        await MainActor.run { c.expectEqual(readiness.finishBlockedBy, ["tool.fast-browser-extension"]) }
    },
]
