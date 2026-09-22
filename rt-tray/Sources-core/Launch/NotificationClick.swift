import Foundation

/// Routing decisions for a delivered notification, kept pure so the click
/// ladder is testable without UserNotifications. The delegate in
/// NotificationManager maps a route onto the real side effect.
public enum NotificationClick {

    public static let readyHeldCategory = "ready_held"
    public static let keyboardConflictCategory = "keyboard_conflict"

    public enum Route: Equatable, Sendable {
        case showKeyboardConflict
        case showProcessPanel
        case openURL(String)
        case focusPane(String)
        case none
    }

    /// The banner-body click. The surface URL outranks pane focus: a
    /// notification that carries a link (a board gate, an MR) opens the
    /// thing it is about, and the pane is reachable through the Focus Pane
    /// action button instead.
    public static func bannerRoute(category: String, url: String?, paneId: String?) -> Route {
        if category == keyboardConflictCategory { return .showKeyboardConflict }
        if category == readyHeldCategory { return .showProcessPanel }
        if let url, !url.isEmpty { return .openURL(url) }
        if let paneId, !paneId.isEmpty { return .focusPane(paneId) }
        return .none
    }

    /// The gate category's Focus Pane action button: the inverse preference
    /// of the banner click, so both targets stay one click away.
    public static func focusPaneRoute(url: String?, paneId: String?) -> Route {
        if let paneId, !paneId.isEmpty { return .focusPane(paneId) }
        if let url, !url.isEmpty { return .openURL(url) }
        return .none
    }
}
