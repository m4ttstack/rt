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
    Check("a quit with no window on screen is a real quit") { c in
        c.expect(QuitReason.shouldTerminate(quitConfirmed: false, sessionEnding: false, updateInstalling: false,
                                            senderBundleIdentifier: nil,
                                            reasonCode: nil, windowOnScreen: false))
    },
    Check("a quit with the window on screen closes the window instead") { c in
        c.expect(!QuitReason.shouldTerminate(quitConfirmed: false, sessionEnding: false, updateInstalling: false,
                                             senderBundleIdentifier: nil,
                                             reasonCode: nil, windowOnScreen: true))
    },
    Check("tray quit, session end, and system reasons terminate even with the window open") { c in
        c.expect(QuitReason.shouldTerminate(quitConfirmed: true, sessionEnding: false, updateInstalling: false,
                                            senderBundleIdentifier: nil,
                                            reasonCode: nil, windowOnScreen: true))
        c.expect(QuitReason.shouldTerminate(quitConfirmed: false, sessionEnding: true, updateInstalling: false,
                                            senderBundleIdentifier: nil,
                                            reasonCode: nil, windowOnScreen: true))
        c.expect(QuitReason.shouldTerminate(quitConfirmed: false, sessionEnding: false, updateInstalling: false,
                                            senderBundleIdentifier: nil,
                                            reasonCode: UInt32(kAEShutDown), windowOnScreen: true))
    },
    Check("Sparkle's install quit terminates even with the window on screen") { c in
        c.expect(QuitReason.shouldTerminate(quitConfirmed: false, sessionEnding: false, updateInstalling: true,
                                            senderBundleIdentifier: "org.sparkle-project.Sparkle.Updater",
                                            reasonCode: nil, windowOnScreen: true))
    },
    Check("a quit that is not Sparkle's install still closes the window") { c in
        c.expect(!QuitReason.shouldTerminate(quitConfirmed: false, sessionEnding: false, updateInstalling: true,
                                             senderBundleIdentifier: nil,
                                             reasonCode: nil, windowOnScreen: true))
        c.expect(!QuitReason.shouldTerminate(quitConfirmed: false, sessionEnding: false, updateInstalling: true,
                                             senderBundleIdentifier: "com.apple.dock",
                                             reasonCode: nil, windowOnScreen: true))
        c.expect(!QuitReason.shouldTerminate(quitConfirmed: false, sessionEnding: false, updateInstalling: false,
                                             senderBundleIdentifier: "org.sparkle-project.Sparkle.Updater",
                                             reasonCode: nil, windowOnScreen: true))
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
