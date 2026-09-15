import Foundation
import CoreServices
import MattstackCore

let quitReasonChecks: [Check] = [
    Check("shutdown/restart/logout/quitAll reasons are system-initiated") { c in
        c.expect(QuitReason.isSystemInitiated(reasonCode: UInt32(kAEShutDown)))
        c.expect(QuitReason.isSystemInitiated(reasonCode: UInt32(kAERestart)))
        c.expect(QuitReason.isSystemInitiated(reasonCode: UInt32(kAEReallyLogOut)))
        c.expect(QuitReason.isSystemInitiated(reasonCode: UInt32(kAEQuitAll)))
    },
    Check("no reason, an unrecognized code, or plain kAELogOut defer to the window-close interception") { c in
        c.expect(!QuitReason.isSystemInitiated(reasonCode: nil))
        c.expect(!QuitReason.isSystemInitiated(reasonCode: 0))
        // kAELogOut ('logo') is the "would you like to log out" prompt event,
        // not a quit reason -- kAEReallyLogOut ('rlgo') is the one AERegistry.h
        // documents as an actual kAEQuitReason value.
        c.expect(!QuitReason.isSystemInitiated(reasonCode: UInt32(kAELogOut)))
    },
]
