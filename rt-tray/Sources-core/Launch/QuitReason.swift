import Foundation
import CoreServices

/// Maps a `kAEQuitApplication` AppleEvent's `kAEQuitReason` parameter (when
/// present) to whether the OS itself is ending the session -- shutdown,
/// restart, or logout -- which the window-close quit interception must
/// never hold up. No reason at all (a plain Cmd-Q or Dock "Quit") is
/// `false`: that's the one case the interception exists to catch.
public enum QuitReason {
    public static func isSystemInitiated(reasonCode: UInt32?) -> Bool {
        guard let reasonCode else { return false }
        return reasonCode == UInt32(kAEShutDown)
            || reasonCode == UInt32(kAERestart)
            || reasonCode == UInt32(kAEReallyLogOut)
            || reasonCode == UInt32(kAEQuitAll)
    }
}
