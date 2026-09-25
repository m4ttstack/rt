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
    public static let worktreeTriageCategory = "worktree_triage"
    /// An invitee replied on the switchboard: the banner offers the confirm
    /// that runs `rt team members sync` for that team.
    public static let memberJoinedCategory = "member_joined"

    public enum Route: Equatable, Sendable {
        case showKeyboardConflict
        case showProcessPanel
        case showWorktreePanel
        case openURL(String)
        case focusPane(String)
        case confirmMembersSync(team: String, handle: String)
        case none

        /// Clicking a notification also activates the app, and activation
        /// with no visible window triggers the reopen handler's window
        /// show. A route that leaves the shell window alone (a pane jump,
        /// a no-op, a modal alert) must suppress that show or every
        /// pane-bound click drags the window up first.
        public var suppressesActivationShow: Bool {
            switch self {
            case .focusPane, .confirmMembersSync, .none: return true
            case .showKeyboardConflict, .showProcessPanel, .showWorktreePanel, .openURL: return false
            }
        }
    }

    public struct AlertCopy: Equatable, Sendable {
        public let title: String
        public let body: String
        public let confirm: String
    }

    /// The banner-body click. The surface URL outranks pane focus: a
    /// notification that carries a link (a board gate, an MR) opens the
    /// thing it is about, and the pane is reachable through the Focus Pane
    /// action button instead. A URL that does not parse must not win the
    /// route: the follower would no-op on it and swallow the pane fallback.
    public static func bannerRoute(category: String, url: String?, paneId: String?, team: String? = nil, handle: String? = nil) -> Route {
        if category == keyboardConflictCategory { return .showKeyboardConflict }
        if category == readyHeldCategory { return .showProcessPanel }
        if category == worktreeTriageCategory { return .showWorktreePanel }
        if category == gatePaneCategory { return focusPaneRoute(url: url, paneId: paneId) }
        if category == memberJoinedCategory { return memberJoinedRoute(team: team, handle: handle) }
        return openRoute(url: url, paneId: paneId)
    }

    /// The team slug reaches `rt team members sync --team` as an argument
    /// and the handle reaches the alert, and the tray socket's /notify is
    /// unauthenticated, so only rt's own shapes may pass: SLUG_PATTERN
    /// (lib/secrets/store.ts) and HANDLE_PATTERN (lib/team/invite.ts).
    public static func memberJoinedRoute(team: String?, handle: String?) -> Route {
        guard let team, isTeamSlug(team), let handle, isHandle(handle) else { return .none }
        return .confirmMembersSync(team: team, handle: handle)
    }

    /// The sync is team-wide: one confirm adds every invitee who has replied, not only the one the banner named.
    public static func membersSyncAlertCopy(team: String, handle: String) -> AlertCopy {
        AlertCopy(
            title: "Add \(handle) to \(team)?",
            body: "This runs rt team members sync for \(team): everyone who has replied to an invite, \(handle) included, becomes a recipient; the team secrets are re-encrypted for them and the change is pushed.",
            confirm: "Add member"
        )
    }

    private static let slugChars = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789")
    private static let handleChars = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")

    private static func isTeamSlug(_ s: String) -> Bool {
        matches(s, first: slugChars, rest: slugChars.union(CharacterSet(charactersIn: "-")), maxLength: 40)
    }

    private static func isHandle(_ s: String) -> Bool {
        matches(s, first: handleChars, rest: handleChars.union(CharacterSet(charactersIn: "._-")), maxLength: 39)
    }

    private static func matches(_ s: String, first: CharacterSet, rest: CharacterSet, maxLength: Int) -> Bool {
        let scalars = Array(s.unicodeScalars)
        guard let head = scalars.first, scalars.count <= maxLength, first.contains(head) else { return false }
        return scalars.dropFirst().allSatisfy { rest.contains($0) }
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
