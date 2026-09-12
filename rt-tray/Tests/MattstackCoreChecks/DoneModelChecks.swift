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

let doneModelChecks: [Check] = [
    Check("finish gate copy is pinned byte for byte") { c in
        c.expectEqual(FinishGate.beforeYouFinishTitle, "Before you finish")
        c.expectEqual(FinishGate.skipSheetTitle, "Skip the Fast Browser extension?")
        c.expectEqual(FinishGate.skipSheetBody, "Without the Fast Browser extension, agents cannot capture screenshots or annotate evidence from your browser. You can load it later from Settings.")
        c.expectEqual(FinishGate.skipSheetConfirm, "Skip for now")
        c.expectEqual(FinishGate.skipSheetCancel, "Cancel")
        c.expectEqual(FinishGate.waivedNotePrefix, "Skipped on this Mac")
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
