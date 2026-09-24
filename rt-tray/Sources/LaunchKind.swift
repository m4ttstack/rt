import AppKit
import MattstackCore

/// Reads the launch Apple Event that started this process.
///
/// `currentAppleEvent` is only non-nil while AppKit is still dispatching that
/// event, which `applicationDidFinishLaunching` is inside of — read it there
/// or not at all. A nil read is `unknown`, and uncertainty never takes the
/// silent branch.
enum TrayLaunchOrigin {
    static func current(_ notification: Notification) -> LaunchOrigin {
        let event = NSAppleEventManager.shared().currentAppleEvent
        return LaunchKind.classify(eventID: event?.eventID,
                                   propData: event?.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue,
                                   isDefaultLaunch: notification.userInfo?[NSApplication.launchIsDefaultUserInfoKey] as? Bool)
    }

    /// The link a GURL launch event carries, if that is what launched us.
    static func launchURL() -> URL? {
        guard let event = NSAppleEventManager.shared().currentAppleEvent,
              event.eventClass == AEEventClass(kInternetEventClass), event.eventID == AEEventID(kAEGetURL),
              let s = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue
        else { return nil }
        return URL(string: s)
    }
}
