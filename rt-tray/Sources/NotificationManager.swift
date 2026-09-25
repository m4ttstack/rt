import Foundation
import AppKit
import MattstackCore
import UserNotifications

// MARK: - NotificationManager

/// Manages UNUserNotificationCenter — permission, categories, firing, and action handling.
class NotificationManager: NSObject, UNUserNotificationCenterDelegate {

    private let center = UNUserNotificationCenter.current()
    /// Set by AppDelegate once it exists (mirrors WindowOpenBridge's own
    /// back-reference), so a notification click can route a mattstack app
    /// URL through the shell window instead of always shelling out.
    weak var appDelegate: AppDelegate?
    /// The bundled rt, handed over by AppDelegate with the delegate itself:
    /// a member_joined confirm runs `rt team members sync` through it.
    var rt: RtRunning?

    override init() {
        super.init()
        center.delegate = self
    }

    /// A mattstack app URL activates that app's tab in the shell window
    /// (same routing AppDelegate.handleGetURL's open branch uses); anything
    /// else keeps today's behavior exactly.
    private func openURL(_ url: URL) {
        guard let request = OpenLink.request(fromHTTPS: url), let appDelegate else {
            NSWorkspace.shared.open(url)
            return
        }
        appDelegate.routeNotificationOpen(request)
    }

    // MARK: - Permission

    func requestPermission() {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                TrayLog.error("notification auth error", ["err": String(describing: error)])
            }
            TrayLog.info("notification permission \(granted ? "granted" : "denied")")
        }
    }

    // MARK: - Categories with Action Buttons

    func registerCategories() {
        let openMR = UNNotificationAction(
            identifier: "OPEN_MR",
            title: "Open MR",
            options: .foreground
        )

        let viewPipeline = UNNotificationAction(
            identifier: "VIEW_PIPELINE",
            title: "View Pipeline",
            options: .foreground
        )

        let merge = UNNotificationAction(
            identifier: "MERGE",
            title: "Merge",
            options: [.foreground, .destructive]
        )

        let showProcesses = UNNotificationAction(
            identifier: "SHOW_PROCESSES",
            title: "Show Processes",
            options: .foreground
        )

        // No .foreground — killing shouldn't drag the app to the front
        let killProcesses = UNNotificationAction(
            identifier: "KILL_PROCESSES",
            title: "Kill",
            options: .destructive
        )

        let fixKeyboard = UNNotificationAction(
            identifier: "FIX_KEYBOARD",
            title: "Show Me How",
            options: .foreground
        )

        let dismissKeyboard = UNNotificationAction(
            identifier: "DISMISS_KEYBOARD",
            title: "Don't Remind Me",
            options: []
        )

        // Copying rather than running it: approving team-authored shell is a
        // deliberate act, and the TTY prompt is where the ladder is shown.
        let copyApproveCommand = UNNotificationAction(
            identifier: "COPY_APPROVE_COMMAND",
            title: "Copy Command",
            options: []
        )

        let focusPane = UNNotificationAction(
            identifier: "FOCUS_PANE",
            title: "Focus Pane",
            options: .foreground
        )

        let openSurface = UNNotificationAction(
            identifier: "OPEN_SURFACE",
            title: "Open",
            options: .foreground
        )

        let addMember = UNNotificationAction(
            identifier: "ADD_MEMBER",
            title: "Add member…",
            options: .foreground
        )

        let categories: [UNNotificationCategory] = [
            UNNotificationCategory(
                identifier: "keyboard_conflict",
                actions: [fixKeyboard, dismissKeyboard],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "pipeline_failed",
                actions: [viewPipeline, openMR],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "pipeline_passed",
                actions: [openMR],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "mr_approved",
                actions: [merge, openMR],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "mr_merged",
                actions: [openMR],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "mr_ready",
                actions: [merge, openMR],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "merge_conflicts",
                actions: [openMR],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "needs_rebase",
                actions: [openMR],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "merge_error",
                actions: [openMR],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "new_comment",
                actions: [openMR],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "stale_port",
                actions: [showProcesses],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "runaway_process",
                actions: [killProcesses, showProcesses],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: Self.readyHeldCategory,
                actions: [copyApproveCommand],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: "gate",
                actions: [focusPane],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: NotificationClick.gatePaneCategory,
                actions: [openSurface],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: NotificationClick.worktreeTriageCategory,
                actions: [],
                intentIdentifiers: []
            ),
            UNNotificationCategory(
                identifier: NotificationClick.memberJoinedCategory,
                actions: [addMember],
                intentIdentifiers: []
            ),
        ]

        center.setNotificationCategories(Set(categories))
    }

    // MARK: - Sound selection

    /// Severity tiers behind the three bundled alert samples. A burst of
    /// notifications plays the highest tier it contains, once.
    private enum SoundTier: Int, Comparable {
        case neutral = 0
        case positive = 1
        case warning = 2

        var resource: String {
            switch self {
            case .neutral:  return "neutral"
            case .positive: return "positive"
            case .warning:  return "warning"
            }
        }

        static func < (lhs: SoundTier, rhs: SoundTier) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    private static func tier(for category: String) -> SoundTier {
        switch category {
        case "pipeline_passed", "mr_approved", "mr_merged", "mr_ready":
            return .positive
        case "pipeline_failed", "mr_closed", "merge_conflicts", "merge_error", "runaway_process",
             readyHeldCategory:
            return .warning
        default:
            return .neutral
        }
    }

    /// How long a burst is collected before its single tone plays. Long enough
    /// to catch one daemon tick's worth of transitions (they arrive stamped the
    /// same millisecond), short enough to stay in sync with the banner.
    private static let coalesceWindow: TimeInterval = 0.25

    /// Burst state — confined to the main queue by `playSound`.
    private static var pendingTier: SoundTier?
    private static var coalescedCount = 0

    /// NSSound must outlive the scope that starts it or playback can be cut short.
    private static var playingSound: NSSound?

    /// Request the alert sound for a notification category.
    ///
    /// A single daemon refresh routinely emits several transitions at once —
    /// approved + ready + needs-rebase on one MR, or conflicts across three
    /// branches, all stamped the same millisecond. Playing one sample per event
    /// overlaps two copies of the same 1.2–5.5s file a millisecond apart, which
    /// is heard as one doubled, phased tone rather than as separate alerts. So a
    /// burst collapses into a single play at its highest severity: whichever
    /// event opens the window, a `pipeline_failed` landing 1ms later still wins
    /// over a `needs_rebase` that arrived first.
    static func playSound(for category: String) {
        let tier = tier(for: category)

        // Burst state is main-queue-confined; the queue-drain path calls in off-main.
        DispatchQueue.main.async {
            if let pending = Self.pendingTier {
                Self.pendingTier = max(pending, tier)
                Self.coalescedCount += 1
                return
            }

            Self.pendingTier = tier
            Self.coalescedCount = 1

            DispatchQueue.main.asyncAfter(deadline: .now() + Self.coalesceWindow) {
                let winner = Self.pendingTier ?? tier
                let count = Self.coalescedCount
                Self.pendingTier = nil
                Self.coalescedCount = 0

                if count > 1 {
                    TrayLog.info("coalesced notification sounds", ["count": count, "tier": winner.resource])
                }
                Self.play(winner)
            }
        }
    }

    /// Resolve the tier → bundled .caf file and play it via NSSound.
    ///
    /// We play the sound manually rather than handing it to UNNotificationSound:
    /// on macOS UNNotificationSound(named:) only resolves files inside
    /// Contents/Library/Sounds/ or ~/Library/Sounds, which complicates app-bundle
    /// layout + ends up ignored in practice. NSSound(contentsOf:) reads straight
    /// from Contents/Resources/.
    ///
    /// Falls back to the built-in macOS "Funk" alert if the bundle didn't ship
    /// the expected .caf (older build, afconvert missing during bundling).
    private static func play(_ tier: SoundTier) {
        TrayLog.info("notification sound", ["tier": tier.resource])

        if let url = Bundle.main.url(forResource: tier.resource, withExtension: "caf"),
           let sound = NSSound(contentsOf: url, byReference: false) {
            playingSound = sound
            sound.play()
            return
        }

        let fallback = NSSound(named: "Funk")
        playingSound = fallback
        fallback?.play()
    }

    // MARK: - Fire Notification

    /// Fire a native macOS notification from a daemon event.
    func fire(_ event: NotificationEvent) {
        let content = UNMutableNotificationContent()
        content.title = event.title
        content.body = event.message
        content.sound = nil  // we play the sound ourselves below
        content.categoryIdentifier = event.category

        // Request the mapped sound. Playback is coalesced across a short window,
        // so a tick that fires several events makes one tone, not a pile.
        Self.playSound(for: event.category)

        // Stash the URL in userInfo so we can open it on click
        if let url = event.url {
            content.userInfo["url"] = url
        }

        // Stash pids so the Kill action can target them
        if let pids = event.pids, !pids.isEmpty {
            content.userInfo["pids"] = pids
        }

        // Stash the pane id so a click focuses the pane instead of opening the URL
        if let paneId = event.paneId, !paneId.isEmpty {
            content.userInfo["paneId"] = paneId
        }

        // member_joined: the confirm names the team and handle from these
        if let team = event.team, !team.isEmpty { content.userInfo["team"] = team }
        if let handle = event.handle, !handle.isEmpty { content.userInfo["handle"] = handle }

        let request = UNNotificationRequest(
            identifier: event.id,
            content: content,
            trigger: nil  // Deliver immediately
        )

        center.add(request) { error in
            if let error = error {
                TrayLog.error("notification error", ["err": String(describing: error)])
            }
        }
    }

    // MARK: - Held ready ladder (RT-98)

    static let readyHeldCategory = NotificationClick.readyHeldCategory

    /// Fire the held-ladder alert.
    ///
    /// Unlike `fire`, this has no daemon `NotificationEvent` behind it: a hold
    /// is a state read off the status poll, not a queued transition, so the
    /// tray composes and de-dupes it (see `ReadyHeldNotifier`).
    ///
    /// `.timeSensitive` is a request, not a guarantee — without the
    /// time-sensitive entitlement macOS quietly downgrades it to `.active`.
    /// The panel badge, not this level, is what makes a hold impossible to miss.
    func fireReadyHeld(_ repo: ReadyHeldRepo) {
        let content = UNMutableNotificationContent()
        content.title = "Team ready steps held: \(repo.label)"
        content.body = "Worktree claims skip the declared steps until you run: \(repo.approveCommand)"
        content.sound = nil
        content.categoryIdentifier = Self.readyHeldCategory
        content.interruptionLevel = .timeSensitive
        content.userInfo["approveCommand"] = repo.approveCommand

        Self.playSound(for: Self.readyHeldCategory)

        // Identified by (hash, repo) so a re-nag replaces the previous banner
        // for the same hold rather than stacking a second copy in the centre.
        let request = UNNotificationRequest(
            identifier: "\(Self.readyHeldCategory):\(ReadyHeldNotifier.ledgerKey(repo))",
            content: content,
            trigger: nil
        )

        center.add(request) { error in
            if let error = error {
                TrayLog.error("ready-held notification error", ["err": String(describing: error)])
            }
        }
    }

    /// Put the approve command on the pasteboard. Approving team-authored
    /// shell stays a deliberate act in a TTY, where the ladder is displayed.
    private static func copyApproveCommand(_ command: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(command, forType: .string)
        TrayLog.info("copied ready-approve command")
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Show notifications even when the app is in the foreground.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner])  // sound is played manually in fire()
    }

    /// Maps a pure route onto its side effect. Focus is best-effort on
    /// click; the outcome isn't surfaced.
    private func follow(_ route: NotificationClick.Route) {
        if route.suppressesActivationShow {
            appDelegate?.suppressReopenShow(for: 2)
        }
        switch route {
        case .showKeyboardConflict:
            NotificationCenter.default.post(name: .showKeyboardConflict, object: nil)
        case .showProcessPanel:
            NotificationCenter.default.post(name: .showProcessPanel, object: nil)
        case .showWorktreePanel:
            NotificationCenter.default.post(name: .showWorktreePanel, object: nil)
        case .openURL(let urlStr):
            if let urlObj = URL(string: urlStr) { openURL(urlObj) }
        case .focusPane(let paneId):
            _ = HerdrBridge.shared.focusPaneById(paneId)
        case .confirmMembersSync(let team, let handle):
            // Off the delegate callback: a modal inside didReceive holds the
            // completion handler for the whole alert and nests a second click.
            DispatchQueue.main.async { [weak self] in self?.confirmMembersSync(team: team, handle: handle) }
        case .none:
            break
        }
    }

    /// The owner half of the invite loop, behind a modal confirm: the reply
    /// blob on the switchboard is unauthenticated, so nothing adds a
    /// recipient until a human says so here.
    private func confirmMembersSync(team: String, handle: String) {
        let copy = NotificationClick.membersSyncAlertCopy(team: team, handle: handle)
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = copy.title
        alert.informativeText = copy.body
        alert.addButton(withTitle: copy.confirm)
        alert.addButton(withTitle: "Not now")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        guard let rt else {
            TrayLog.error("members sync: no rt client", ["team": team])
            fireLocal(title: "Could not add \(handle)", message: "rt is not available to this app; run: rt team members sync --team \(team)")
            return
        }
        Task {
            let args = ["team", "members", "sync", "--team", team, "--json"]
            do {
                let result = try await rt.run(args, stdin: nil)
                if let e = result.userError(redactStderr: false) {
                    TrayLog.warn("members sync failed", ["team": team, "err": e.message])
                    fireLocal(title: "Could not add \(handle) to \(team)", message: e.message)
                } else if result.exitCode != 0 {
                    let copy = result.failureCopy(verb: args.joined(separator: " "), redactStderr: false)
                    TrayLog.warn("members sync failed", ["team": team, "err": copy])
                    fireLocal(title: "Could not add \(handle) to \(team)", message: copy)
                } else {
                    switch MembersSyncOutcome.parse(stdout: result.stdout, handle: handle) {
                    case .added:
                        fireLocal(title: "Added \(handle) to \(team)", message: "Their key is a recipient now; the team clone pushes on its next cycle.")
                    case .pending:
                        fireLocal(title: "\(handle) is not added yet", message: "Their reply could not be used (it did not decrypt, or its key is already a recipient). The invite stays open; rt team members sync will retry.")
                    case .notFound:
                        fireLocal(title: "No invite for \(handle) in \(team)", message: "Their invite record is gone, so there was nothing to add. Anyone else who had replied was added.")
                    case .unknown:
                        fireLocal(title: "Members sync ran for \(team)", message: "rt did not report a result for \(handle); check rt team members sync --team \(team).")
                    }
                }
            } catch {
                let copy = (error as? RtClientError)?.copy ?? "rt team members sync failed to start."
                TrayLog.warn("members sync failed", ["team": team, "err": copy])
                fireLocal(title: "Could not add \(handle) to \(team)", message: copy)
            }
        }
    }

    /// A tray-originated banner with no click route: the outcome of an action the user just confirmed.
    private func fireLocal(title: String, message: String) {
        fire(NotificationEvent(
            id: UUID().uuidString, title: title, message: message, url: nil, category: "general",
            timestamp: Int(Date().timeIntervalSince1970), pids: nil, paneId: nil, team: nil, handle: nil
        ))
    }

    /// Handle notification click and action button presses.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let url = userInfo["url"] as? String

        switch response.actionIdentifier {
        case "OPEN_MR":
            if let urlStr = url, let urlObj = URL(string: urlStr) {
                openURL(urlObj)
            }

        case "FOCUS_PANE":
            follow(NotificationClick.focusPaneRoute(
                url: url,
                paneId: userInfo["paneId"] as? String
            ))

        case "OPEN_SURFACE":
            follow(NotificationClick.openRoute(
                url: url,
                paneId: userInfo["paneId"] as? String
            ))

        case UNNotificationDefaultActionIdentifier:
            follow(NotificationClick.bannerRoute(
                category: response.notification.request.content.categoryIdentifier,
                url: url,
                paneId: userInfo["paneId"] as? String,
                team: userInfo["team"] as? String,
                handle: userInfo["handle"] as? String
            ))

        case "ADD_MEMBER":
            follow(NotificationClick.memberJoinedRoute(
                team: userInfo["team"] as? String,
                handle: userInfo["handle"] as? String
            ))

        case "COPY_APPROVE_COMMAND":
            if let command = userInfo["approveCommand"] as? String {
                Self.copyApproveCommand(command)
            }

        case "VIEW_PIPELINE":
            // Append /pipelines to the MR URL to land on its Pipelines tab;
            // fall back to the MR itself if the composed URL is invalid.
            if let urlStr = url, let urlObj = URL(string: urlStr) {
                let pipelineURL = URL(string: urlStr + "/pipelines") ?? urlObj
                openURL(pipelineURL)
            }

        case "MERGE":
            // TODO: Send merge command to daemon via socket
            // For now, open the MR so user can merge from the UI
            if let urlStr = url, let urlObj = URL(string: urlStr) {
                openURL(urlObj)
            }

        case "SHOW_PROCESSES":
            NotificationCenter.default.post(name: .showProcessPanel, object: nil)

        case "KILL_PROCESSES":
            if let pids = userInfo["pids"] as? [Int], !pids.isEmpty {
                Self.killPids(pids)
            }

        case "FIX_KEYBOARD":
            NotificationCenter.default.post(name: .showKeyboardConflict, object: nil)

        case "DISMISS_KEYBOARD":
            MissionControlCheck.hasShownNotification = true

        default:
            break
        }

        completionHandler()
    }

    // MARK: - Kill action

    /// SIGTERM the pids (process group when the pid leads one), then escalate
    /// survivors to SIGKILL after 5s — same semantics as the process panel.
    static func killPids(_ pids: [Int]) {
        TrayLog.info("notification kill action", ["pids": pids])
        for pid in pids {
            _ = sendSignal(pid, SIGTERM)
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
            let survivors = pids.filter { kill(Int32($0), 0) == 0 }
            for pid in survivors {
                _ = sendSignal(pid, SIGKILL)
            }
            if !survivors.isEmpty {
                TrayLog.warn("notification kill escalated to SIGKILL", ["pids": survivors])
            }
        }
    }

    private static func sendSignal(_ pid: Int, _ signal: Int32) -> Bool {
        let p = Int32(pid)
        if getpgid(p) == p, kill(-p, signal) == 0 {
            return true
        }
        return kill(p, signal) == 0
    }
}

// MARK: - Notification.Name

extension Notification.Name {
    static let showProcessPanel = Notification.Name("showProcessPanel")
    static let detachProcessPanel = Notification.Name("detachProcessPanel")
    static let showKeyboardConflict = Notification.Name("showKeyboardConflict")
    static let showWorktreePanel = Notification.Name("showWorktreePanel")
}
