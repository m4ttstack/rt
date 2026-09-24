import Foundation
import UserNotifications

/// The notification a login-item stand-down posts on its way to quitting.
enum StandDownNotice {

    /// `UNUserNotificationCenter.current()` traps in a process with no bundle
    /// identity (an unbundled `swift build` binary).
    private static var isAvailable: Bool { Bundle.main.bundleIdentifier != nil }

    static func post(title: String, body: String, identifier: String, completion: @escaping () -> Void) {
        guard isAvailable else {
            TrayLog.warn("notification skipped (unbundled process)", ["id": identifier])
            completion()
            return
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = nil
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error {
                TrayLog.warn("notification failed", ["id": identifier, "err": String(describing: error)])
            }
            completion()
        }
    }
}
