import Foundation
import CoreServices

public enum LaunchOrigin: Equatable, Sendable {
    case loginItem
    case userLaunch
    case unknown
}

/// How this launch was started, read from the launch Apple Event.
///
/// The absence of an event is `unknown`, not `userLaunch`: a user launch
/// takes the Mac over from the other app and a login item may retire this
/// one, so neither may rest on a guess.
public enum LaunchKind {
    public static func classify(eventID: UInt32?, propData: UInt32?) -> LaunchOrigin {
        guard let eventID else { return .unknown }
        guard eventID == UInt32(kAEOpenApplication) else { return .userLaunch }
        return propData == UInt32(keyAELaunchedAsLogInItem) ? .loginItem : .userLaunch
    }
}
