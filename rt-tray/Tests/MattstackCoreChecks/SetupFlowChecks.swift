import Foundation
import MattstackCore

let setupFlowChecks: [Check] = [
    Check("SetupStep order, titles, indicator") { c in
        c.expectEqual(SetupStep.allCases.map(\.rawValue), [0, 1, 2, 3, 4])
        c.expectEqual(SetupStep.checklist.indicator, "Step 3 of 5")
        c.expectEqual(SetupStep.team.title, "Your team")
        c.expectEqual(SetupStep.checklist.title, "Before we begin")
    },
    Check("flow: next/back bounds, continue titles, back disabled on welcome/install-running/done, close only on done") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            c.expectEqual(f.step, .welcome)
            c.expectEqual(f.canGoBack, false)
            c.expectEqual(f.windowMayClose, false)
            f.back(); c.expectEqual(f.step, .welcome)
            f.next(); c.expectEqual(f.step, .team); c.expectEqual(f.canGoBack, true)
            f.next(); c.expectEqual(f.step, .checklist); c.expectEqual(f.continueTitle, "Install")
            f.next(); c.expectEqual(f.step, .install)
            f.isInstalling = true; c.expectEqual(f.canGoBack, false)
            f.isInstalling = false; c.expectEqual(f.canGoBack, true)
            f.next(); c.expectEqual(f.step, .done); c.expectEqual(f.continueTitle, "Finish")
            c.expectEqual(f.canGoBack, false); c.expectEqual(f.windowMayClose, true)
            f.next(); c.expectEqual(f.step, .done)
            f.jump(to: .team); c.expectEqual(f.step, .team)
        }
    },
    Check("read-only flow (Setup status…): no Back, primary closes instead of installing, never starts a run") { c in
        await MainActor.run {
            let f = SetupFlowModel(readOnly: true)
            f.jump(to: .checklist)
            c.expectEqual(f.showsBack, false, "a health view has no wizard behind it to walk back into")
            c.expectEqual(f.canGoBack, false)
            c.expectEqual(f.continueTitle, "Close", "Install here would start a real rt setup apply")
            c.expectEqual(f.primaryClosesWindow, true)
            c.expectEqual(f.mayStartInstall, false)
            let wizard = SetupFlowModel()
            wizard.jump(to: .checklist)
            c.expectEqual(wizard.showsBack, true)
            c.expectEqual(wizard.continueTitle, "Install")
            c.expectEqual(wizard.primaryClosesWindow, false)
            c.expectEqual(wizard.mayStartInstall, true)
        }
    },
    Check("windowMayClose follows the finish gate on Done and nowhere else") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .done)
            c.expectEqual(f.windowMayClose, true)
            f.finishBlockedBy = ["tool.fast-browser-extension"]
            c.expectEqual(f.windowMayClose, false, "a blocked Finish closes the titlebar buttons too")
            c.expectEqual(f.continueTitle, "Finish")
            f.finishBlockedBy = []
            c.expectEqual(f.windowMayClose, true)
            f.jump(to: .checklist)
            c.expectEqual(f.windowMayClose, false, "the gate never opens a non-Done step")
        }
    },
]
