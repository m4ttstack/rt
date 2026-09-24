import Foundation
import CoreServices

public enum LaunchOrigin: Equatable, Sendable {
    case loginItem
    case userLaunch
    /// Launched to open a link or document: LaunchServices may pick whichever
    /// app handles the scheme, so this is not the user choosing the app.
    case urlLaunch
    case unknown
}

/// How this launch was started, read from the launch Apple Event and the
/// launch notification's `NSApplicationLaunchIsDefaultLaunchKey`.
///
/// The absence of an event is `unknown`, not `userLaunch`: a user launch
/// takes the Mac over from the other app and a login item may retire this
/// one, so neither may rest on a guess.
public enum LaunchKind {
    public static func classify(eventID: UInt32?, propData: UInt32?, isDefaultLaunch: Bool?) -> LaunchOrigin {
        guard let eventID else { return .unknown }
        guard eventID == UInt32(kAEOpenApplication) else { return .urlLaunch }
        if propData == UInt32(keyAELaunchedAsLogInItem) { return .loginItem }
        return isDefaultLaunch == false ? .urlLaunch : .userLaunch
    }
}
