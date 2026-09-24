import Foundation

/// Decided in `main.swift`, before any object graph exists, and read by the
/// AppDelegate once the launch origin is known.
enum FlavorLaunchState {
    /// The other flavor's tray, found live on `tray.sock` at launch.
    static var otherTrayAlive: String?

    /// Set only while this launch takes the Mac over: the one case that
    /// licenses evicting the other flavor's live tray from the socket.
    static var takingOver = false
}
