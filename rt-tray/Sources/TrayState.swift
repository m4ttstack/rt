import Foundation
import MattstackCore
import SwiftUI

/// Daemon status shared between AppDelegate (which polls) and the process
/// panel (which displays it in the status strip). A singleton because the
/// popover and the detached window each host their own panel instance.
///
/// Main-actor: every `@Published` write lands in SwiftUI's observation
/// synchronously on the writing thread, so an off-main mutation drives
/// AppKit view updates off-main (a recurring reloadData SIGABRT). The
/// annotation turns that whole bug class into a compile error.
@MainActor
class TrayState: ObservableObject {
    static let shared = TrayState()

    @Published var health: DaemonHealth = .unknown
    @Published var statusText: String = "Daemon: checking…"
    /// SMAppService wants the user to approve the daemon in Login Items.
    @Published var needsApproval: Bool = false
    /// Set when UpdaterController finds a newer release (its version string).
    @Published var updateAvailable: String? = nil
    /// Mirrors UpdaterController's Sparkle KVO — gates the gear menu's
    /// "Check for Updates…" item independently of an already-found update.
    @Published var canCheckForUpdates: Bool = false

    // ── Boot/crash diagnostics (S026/S028/S029) ─────────────────────────────
    /// `supervision.bootAttempts` from the daemon's `ping` reply, nil until
    /// the first successful supervision query.
    @Published var restartCount: Int? = nil
    /// Human-readable reason for the most recent recorded boot failure or
    /// crash-loop, nil when there is none on record.
    @Published var lastCrashReason: String? = nil
    /// One of "crash-looping" / "boot-failed" / "alive but not serving",
    /// nil when the daemon isn't in any of those states.
    @Published var bootVerdict: String? = nil

    // ── Degraded-health cause (phase 2) ─────────────────────────────────────
    /// The daemon's own `health.reasons` (or `.level` as a fallback), set
    /// whenever `health == .degraded` — the red-flicker class becomes a
    /// named cause instead of an unexplained color change.
    @Published var failingSubsystem: String? = nil

    // ── Held ready ladders (RT-98) ──────────────────────────────────────────
    /// Repos whose team-authored `ready` steps the daemon is holding pending
    /// approval. Every worktree claim in these repos runs degraded, so the
    /// panel badges them until someone approves; unlike the notification, this
    /// cannot be dismissed.
    @Published var readyHeldRepos: [ReadyHeldRepo] = []

    /// A hand-installed deck agent the tray could not remove before
    /// registering the deck helper, so deck may be running unowned or not at all.
    @Published var handDeckBlocked: HandDeckBlockedNotice? = nil

    // ── Dev flavor: restart to a new build ──────────────────────────────────
    /// The staged build's stamp, set only while it differs from the running
    /// app's (DevBuildWatcher).
    @Published var stagedBuildStamp: String? = nil
    @Published var devRebuild: DevRebuildState = .idle
    /// The tree the running or last failed rebuild came from.
    @Published var devRebuildTree: String? = nil

    var healthColor: Color {
        switch health {
        case .healthy:  return .green
        case .starting: return .yellow
        case .warning:  return .orange
        case .degraded: return .pink
        case .down:     return .red
        case .unknown:  return .secondary
        }
    }
}

// Gear-menu actions the panel posts back to AppDelegate, which owns the
// daemon lifecycle and update checker.
extension Notification.Name {
    static let rtRestartDaemon  = Notification.Name("rtRestartDaemon")
    static let rtStopDaemon     = Notification.Name("rtStopDaemon")
    static let rtViewDaemonLogs = Notification.Name("rtViewDaemonLogs")
    static let rtOpenCrashLog   = Notification.Name("rtOpenCrashLog")
    static let rtCheckUpdates   = Notification.Name("rtCheckUpdates")
    static let rtShowSetupStatus = Notification.Name("rtShowSetupStatus")
    static let rtShowSettings    = Notification.Name("rtShowSettings")
    static let rtShowUninstall   = Notification.Name("rtShowUninstall")
    static let rtQuitMattstack   = Notification.Name("rtQuitMattstack")
    static let showMattstackWindow = Notification.Name("showMattstackWindow")
    static let rtDevRestartIntoStaged = Notification.Name("rtDevRestartIntoStaged")
    static let rtDevRebuildChanged = Notification.Name("rtDevRebuildChanged")
}
