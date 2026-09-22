import Foundation

/// Routing decisions for a delivered notification, kept pure so the click
/// ladder is testable without UserNotifications. The delegate in
/// NotificationManager maps a route onto the real side effect.
public enum NotificationClick {

    public static let readyHeldCategory = "ready_held"
    public static let keyboardConflictCategory = "keyboard_conflict"
    /// A pane-initiated gate (the notify-bridge specializes these): the
    /// banner returns to the pane that is driving the work, and the URL
    /// moves to the Open action button.
    public static let gatePaneCategory = "gate_pane"

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
    /// action button instead. A URL that does not parse must not win the
    /// route: the follower would no-op on it and swallow the pane fallback.
    public static func bannerRoute(category: String, url: String?, paneId: String?) -> Route {
        if category == keyboardConflictCategory { return .showKeyboardConflict }
        if category == readyHeldCategory { return .showProcessPanel }
        if category == gatePaneCategory { return focusPaneRoute(url: url, paneId: paneId) }
        return openRoute(url: url, paneId: paneId)
    }

    /// The gate_pane category's Open action button, and the default banner
    /// tail: the surface URL first, pane focus as the fallback. A URL that
    /// does not parse must not win the route: the follower would no-op on
    /// it and swallow the pane fallback.
    public static func openRoute(url: String?, paneId: String?) -> Route {
        if let url, isOpenableURL(url) { return .openURL(url) }
        if let paneId, !paneId.isEmpty { return .focusPane(paneId) }
        return .none
    }

    /// The gate category's Focus Pane action button: the inverse preference
    /// of the banner click, so both targets stay one click away.
    public static func focusPaneRoute(url: String?, paneId: String?) -> Route {
        if let paneId, !paneId.isEmpty { return .focusPane(paneId) }
        if let url, isOpenableURL(url) { return .openURL(url) }
        return .none
    }

    /// Only http(s) may reach NSWorkspace: the tray socket's /notify is
    /// unauthenticated, so a URL from an event is untrusted input, and any
    /// other scheme would hand a click to an arbitrary registered handler.
    private static func isOpenableURL(_ url: String) -> Bool {
        guard let scheme = URL(string: url)?.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }
}
