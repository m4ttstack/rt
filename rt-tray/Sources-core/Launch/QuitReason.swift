import Foundation
import CoreServices

/// Maps a `kAEQuitApplication` AppleEvent's `kAEQuitReason` parameter (when
/// present) to whether the OS itself is ending the session -- shutdown,
/// restart, or logout -- which the window-close quit interception must
/// never hold up. No reason at all (a plain Cmd-Q or Dock "Quit") is
/// `false`: that's the one case the interception exists to catch.
public enum QuitReason {
    /// Sparkle's installer agent, `Updater.app`, which sends the install quit.
    public static let sparkleInstallerBundleIdentifier = "org.sparkle-project.Sparkle.Updater"

    /// The whole quit decision: true terminates, false hands the quit to the
    /// window-close interception. A quit arriving with no window on screen
    /// has nothing to close, and it is the only path a script, the Dock, or
    /// Activity Monitor can take once the window is closed, so it stands as
    /// a real quit. Sparkle's installer quits the app with the same plain
    /// event as Cmd-Q, so while an update is installing its quit, told apart
    /// by the sender, must go through or the install never happens.
    public static func shouldTerminate(quitConfirmed: Bool,
                                       sessionEnding: Bool,
                                       updateInstalling: Bool,
                                       senderBundleIdentifier: String?,
                                       reasonCode: UInt32?,
                                       windowOnScreen: Bool) -> Bool {
        if quitConfirmed || sessionEnding { return true }
        if updateInstalling && senderBundleIdentifier == sparkleInstallerBundleIdentifier { return true }
        if isSystemInitiated(reasonCode: reasonCode) { return true }
        return !windowOnScreen
    }

    public static func isSystemInitiated(reasonCode: UInt32?) -> Bool {
        guard let reasonCode else { return false }
        return reasonCode == UInt32(kAEShutDown)
            || reasonCode == UInt32(kAERestart)
            || reasonCode == UInt32(kAEReallyLogOut)
            || reasonCode == UInt32(kAEQuitAll)
    }
}
