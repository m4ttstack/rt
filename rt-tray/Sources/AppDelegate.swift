import AppKit
import UserNotifications
import ServiceManagement
import Network
import SwiftUI
import MattstackCore

// MARK: - AppDelegate

// `VersionProviding` (a `Sendable` protocol, adopted below) lets `TrayRoutes`
// call `versionInfo()` from its own async route-handling `Task`, off the main
// actor — the only member of this class ever reached off-main, and it only
// reads immutable process-global state (`Bundle.main`, `BundleFlavor`).
// `@unchecked` because the compiler can't see that from the conformance site.
class AppDelegate: NSObject, NSApplicationDelegate, @unchecked Sendable {

    // ── Menu bar ────────────────────────────────────────────────────────────
    private var statusItem: NSStatusItem!

    // ── Daemon communication ────────────────────────────────────────────────
    private let daemonClient = DaemonClient()
    private let notificationManager = NotificationManager()
    private let daemonLifecycle = DaemonLifecycle()

    // ── Polling timers ──────────────────────────────────────────────────────
    private var statusTimer: Timer?
    private var notificationTimer: Timer?

    // ── Process panel ──────────────────────────────────────────────────────
    private var processPopover: NSPopover?
    private var processWindow: NSWindow?
    private var keyboardConflictWindow: NSWindow?

    // ── State ───────────────────────────────────────────────────────────────
    private var currentHealth: DaemonHealth = .unknown
    /// This process's own start time -- the freshness cutoff for tray-crash.log,
    /// mirroring how lastKnownDaemonStartedAt gates daemon-stderr.log (S029).
    private let appLaunchedAt = Date()
    // `lazy`: constructing it starts Sparkle (when enabled). A translocated
    // or DMG-mounted launch returns before `buildServices()` (the first
    // touch) ever runs, so Sparkle never spins up on a copy that's about to
    // be told to quit. Stub mode counts as a dev build here too -- the
    // placeholder SUPublicEDKey already blocks Sparkle in every build this
    // repo produces, but a future real key must not revive it under the
    // stub-driven UI-test/QA harness.
    lazy var updater = UpdaterController(isDevBuild: BundleFlavor.isDevBuild || BundleFlavor.isStubActive, isBusy: { SetupSession.isRunning })
    private var updaterObservation: NSKeyValueObservation?

    // ── Setup / Settings / rt ────────────────────────────────────────────────
    private var permissionsService: PermissionsService!
    private var servicesRegistrar: ServicesRegistrar!
    private var needBroker: NeedBroker!
    private var coordinator: SetupCoordinator?
    private var rtClient: RtClient?
    // `mattstackWindow` holds the controller strongly: `WindowModel.controller`
    // is weak, so an unretained controller deallocates and every show()/open()
    // silently no-ops.
    // fileprivate, not private: `WindowOpenBridge` below reads it across the
    // MainActor hop, and `private` would not reach a sibling top-level type.
    fileprivate var windowModel: WindowModel?
    private var mattstackWindow: MattstackWindowController?
    private var badgePoller: BadgePoller?
    private var hotkey: HotkeyManager?
    /// A `mattstack://join/<code>` event can arrive before `buildServices()`
    /// builds the coordinator (launch-by-link). Stashed here and drained at
    /// the end of `buildServices()`.
    private var pendingJoinCode: String?
    /// A `mattstack://open/...` or https `*.mattstack` event can arrive
    /// before `buildServices()` constructs `windowModel` (launch-by-link).
    /// Stashed here and drained at the end of `buildServices()`.
    private var pendingOpen: OpenRequest?
    /// Set only by the tray menu's "Quit mattstack" action, immediately
    /// before it calls `NSApp.terminate(nil)`. Every other path to
    /// termination (Cmd-Q, Dock right-click Quit) is intercepted by
    /// `applicationShouldTerminate` and turned into a window close instead.
    private var quitConfirmed = false
    /// Set by `NSWorkspace.willPowerOffNotification`, an independent signal
    /// from the quit AppleEvent's `kAEQuitReason` parameter -- which is
    /// documented as optional, so a genuine shutdown/restart/logout whose
    /// event omits it would otherwise fall through to the window-close
    /// path and visibly block the OS ("app is preventing logout/shutdown").
    /// This backstop trusts the session itself, not just the reason code.
    private var systemSessionEnding = false

    // MARK: - Lifecycle

    /// Registered ahead of the first event so a `mattstack://join/<code>` link
    /// used to launch the app (not just to activate an already-running one)
    /// still reaches `handleGetURL`.
    func applicationWillFinishLaunching(_ notification: Notification) {
        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleGetURL(_:with:)),
                                                     forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if LaunchGuard.isTranslocatedOrOnRemovableVolume(bundlePath: Bundle.main.bundlePath) {
            showMoveToApplicationsAlert()
            return
        }
        // The launch event is only current while AppKit is dispatching it, so
        // the origin is read here rather than anywhere downstream.
        let origin = TrayLaunchOrigin.current()
        let plan = FlavorLaunch.plan(origin: origin, otherTrayAlive: FlavorLaunchState.otherTrayAlive)
        TrayLog.info("flavor launch", ["origin": String(describing: origin), "plan": String(describing: plan)])
        switch plan {
        case .serve: startNormalOperation()
        case .takeOver: takeOver()
        case .standDown(let other): standDown(other: other)
        case .ask(let other): askToTakeOver(other: other)
        }
    }

    /// Everything a serving tray does at launch, once: after a takeover that
    /// had to wait for the other app to let go of the socket, it runs then.
    @MainActor
    private func startNormalOperation() {
        buildServices()
        hotkey = HotkeyManager { [weak self] in Task { @MainActor in self?.windowModel?.toggleVisibility() } }
        installMainMenu()
        setupMenuBar()
        setupNotifications()
        setupTrayServer()
        startPolling()
        setupAutoUpdate()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(showProcessPanel),
            name: .showProcessPanel,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(detachProcessPanel),
            name: .detachProcessPanel,
            object: nil
        )

        // Gear-menu actions posted by the panel's status strip
        NotificationCenter.default.addObserver(
            self, selector: #selector(restartDaemon), name: .rtRestartDaemon, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(stopDaemon), name: .rtStopDaemon, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(viewDaemonLogs), name: .rtViewDaemonLogs, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(openCrashLog), name: .rtOpenCrashLog, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(checkForUpdates), name: .rtCheckUpdates, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(showKeyboardConflictWindow), name: .showKeyboardConflict, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(showMattstackWindow), name: .showMattstackWindow, object: nil)
        // The process panel's own gear-menu "Quit mattstack" (distinct from
        // the tray menu's, which calls quitFromTray() directly) posts this
        // instead of calling NSApp.terminate itself, so it goes through the
        // same quitConfirmed gate -- calling terminate without it would just
        // be intercepted by applicationShouldTerminate and turned into a
        // window close.
        NotificationCenter.default.addObserver(
            self, selector: #selector(quitFromTray), name: .rtQuitMattstack, object: nil)

        // Independent backstop for applicationShouldTerminate: the quit
        // AppleEvent's kAEQuitReason is documented optional, so a real
        // power-off/restart whose event omits it would otherwise fall
        // through to the window-close path and visibly block the OS.
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(handleSystemSessionEnding), name: NSWorkspace.willPowerOffNotification, object: nil)

        // Setup / Settings surfaces, posted by the gear menu and the Done screen
        NotificationCenter.default.addObserver(self, selector: #selector(showSetupStatus), name: .rtShowSetupStatus, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(showSettings), name: .rtShowSettings, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(showUninstall), name: .rtShowUninstall, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(showSettingsTeam), name: .rtShowSettingsTeam, object: nil)

        checkMissionControlConflict()
        autoRegisterLoginItem()

        Task { @MainActor in
            setHealth(.starting)
            if BundleFlavor.isStubActive {
                TrayLog.info("stub mode: skipping real service registration and version-change restart")
            } else {
                await servicesRegistrar.registerAll()
                let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
                let change = await servicesRegistrar.handleVersionChange(current: version, store: UserDefaults.standard)
                TrayLog.info("version change evaluated", ["change": String(describing: change)])
            }
            await recordAppPath()

            // First-run Setup has no daemon dependency — show it now rather
            // than after the wait loop below, or a genuine first run (daemon
            // not installed yet) sits at a blank menu bar for the full 4s.
            if let coordinator, !coordinator.setupIsComplete {
                coordinator.showSetup(step: SetupResume.step(from: CommandLine.arguments))
            }

            // Wait for launchd to bring the daemon up
            for _ in 0..<8 {
                try? await Task.sleep(nanoseconds: 500_000_000)
                if await daemonClient.isReachable() { break }
            }
            await refreshStatus()
            await drainPendingNotifications()
        }
    }

    // MARK: - Flavor takeover and stand-down

    /// Opened by hand: this app takes the Mac. With nothing else on the socket
    /// it serves at once and the takeover clears the other app's leftovers
    /// behind it; with the other app's tray live, serving waits until the
    /// takeover has retired and quit it.
    @MainActor
    private func takeOver() {
        FlavorLaunchState.takingOver = true
        guard FlavorLaunchState.otherTrayAlive != nil else {
            startNormalOperation()
            Task { @MainActor in
                if let failure = await runTakeover() { reportTakeoverFailure(failure, fatal: false) }
            }
            return
        }
        let myFlavor = FlavorIdentity.flavorName(isDevBuild: BundleFlavor.isDevBuild)
        Task { @MainActor in
            if let failure = await runTakeover() {
                reportTakeoverFailure(failure, fatal: true)
                return
            }
            switch TrayServer.claimSocket() {
            case .claimed:
                startNormalOperation()
            case .heldByPeer(let flavor), .heldByStuckHolder(let flavor):
                reportTakeoverFailure(FlavorStandDownCopy.stuckHolderBody(holderFlavor: flavor, myFlavor: myFlavor),
                                      fatal: true)
            }
        }
    }

    /// `rt flavor takeover <mine>`: retires and quits the other app, boots
    /// out its jobs, and points ~/.local/bin/rt here. Nil on success, else
    /// the copy to show.
    @MainActor
    private func runTakeover() async -> String? {
        guard !BundleFlavor.isStubActive else {
            TrayLog.info("takeover skipped (stub mode)")
            return nil
        }
        let myFlavor = FlavorIdentity.flavorName(isDevBuild: BundleFlavor.isDevBuild)
        guard let rt = RtClientFactory.make() else {
            return "mattstack could not find its rt command, so it can't switch this Mac to \(myFlavor)."
        }
        let verb = "flavor takeover"
        do {
            let r = try await rt.run(FlavorLaunch.takeoverArguments(myFlavorIsDev: BundleFlavor.isDevBuild), stdin: nil)
            guard r.exitCode == 0 else { return r.userError?.message ?? r.failureCopy(verb: verb) }
            TrayLog.info("took this Mac over", ["flavor": myFlavor, "reply": String(decoding: r.stdout.prefix(2000), as: UTF8.self)])
            return nil
        } catch {
            return (error as? RtClientError)?.copy ?? "rt \(verb) failed to start."
        }
    }

    /// A login item while the other app runs: that app keeps the Mac, so
    /// this one gives up its daemon agent and login item and quits. Opening
    /// it by hand later takes the Mac back.
    @MainActor
    private func standDown(other: String) {
        let myFlavor = FlavorIdentity.flavorName(isDevBuild: BundleFlavor.isDevBuild)
        TrayLog.info("flavor stand-down", ["other": other, "flavor": myFlavor])
        Task { @MainActor in await retireSelf(other: other, myFlavor: myFlavor) }
    }

    @MainActor
    private func retireSelf(other: String, myFlavor: String) async {
        await daemonLifecycle.stopDaemonForTeardown(origin: DaemonOrigin.flavorRetire)
        do {
            try await SMAppService.mainApp.unregister()
        } catch {
            // Unregistering an already-unregistered login item throws; the
            // status logged below is the ground truth.
            TrayLog.warn("login item unregister failed", ["err": String(describing: error)])
        }
        _ = await TrayServer.retireHandDeckAgent()
        TrayLog.info("stood down", ["daemon": TrayServer.statusName(daemonLifecycle.status),
                                    "loginItem": TrayServer.statusName(SMAppService.mainApp.status)])
        // The notification is the only trace this leaves, so the quit waits
        // for delivery, with a backstop for a callback that never comes.
        StandDownNotice.post(title: FlavorStandDownCopy.notificationTitle(myFlavor: myFlavor),
                             body: FlavorStandDownCopy.notificationBody(myFlavor: myFlavor, other: other),
                             identifier: "mattstack-flavor-stand-down") {
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { NSApp.terminate(nil) }
    }

    /// A launch this process could not identify while the other app runs:
    /// neither taking the Mac nor retiring this app happens on a guess.
    @MainActor
    private func askToTakeOver(other: String) {
        let myFlavor = FlavorIdentity.flavorName(isDevBuild: BundleFlavor.isDevBuild)
        let alert = NSAlert()
        alert.messageText = FlavorStandDownCopy.askTitle(other: other)
        alert.informativeText = FlavorStandDownCopy.askBody(myFlavor: myFlavor, other: other)
        alert.addButton(withTitle: FlavorStandDownCopy.switchButton(myFlavor: myFlavor))
        alert.addButton(withTitle: FlavorStandDownCopy.quitButton)
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else {
            TrayLog.info("takeover declined", ["other": other])
            NSApp.terminate(nil)
            return
        }
        takeOver()
    }

    /// `fatal` distinguishes a failure before this app serves (nothing is
    /// running, so quitting is the honest end) from one behind an app that is
    /// already serving, which keeps working.
    @MainActor
    private func reportTakeoverFailure(_ message: String, fatal: Bool) {
        TrayLog.error("flavor takeover failed", ["err": message, "fatal": fatal])
        let alert = NSAlert()
        alert.messageText = FlavorStandDownCopy.takeoverFailedTitle
        alert.informativeText = message
        alert.addButton(withTitle: fatal ? FlavorStandDownCopy.quitButton : "OK")
        alert.runModal()
        if fatal { NSApp.terminate(nil) }
    }

    /// Dock icon click with the last window closed: AppKit sends this instead
    /// of reopening anything on its own once the app has no windows. `flag`
    /// is true when a window is already visible, in which case the default
    /// system behavior (raise it) is left alone.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            // A notification click that routed to a pane activates this app
            // as a side effect; showing the shell window would upstage the
            // pane the user is being sent to.
            if Date() < suppressReopenShowUntil { return true }
            // `hasVisibleWindows` is false for a miniaturized window too, so
            // without this check a dock click would navigate to the oldest
            // badged decision on top of whatever Matt had open.
            let isMiniaturized = mattstackWindow?.window?.isMiniaturized ?? false
            Task { @MainActor in
                if !isMiniaturized, let model = self.windowModel, let request = model.firstBadgedRequest() {
                    self.mattstackWindow?.show()
                    if await model.open(request) { return }
                }
                if isMiniaturized { self.mattstackWindow?.window?.deminiaturize(nil) }
                // `windowModel.controller` is a weak back-reference; fall
                // back to the strongly-held `mattstackWindow` ivar if it's
                // ever nil so a Dock click can't silently no-op.
                if let controller = self.windowModel?.controller {
                    controller.show()
                } else {
                    self.mattstackWindow?.show()
                }
            }
        }
        return true
    }

    /// Dock-first quit interception (tray-and-quit spec, 2026-09-15): the
    /// tray menu's "Quit mattstack" is the only real quit (`quitConfirmed`).
    /// Every other path -- Cmd-Q with the window key, Dock right-click Quit
    /// -- closes the window instead (dropping the app back to `.accessory`
    /// via the existing `windowWillClose`) and cancels the termination, so
    /// daemon supervision never dies just because the window did. System
    /// shutdown/restart/logout are read from the quit AppleEvent's reason
    /// and always honored: this interception must never block the OS.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let reasonCode = NSAppleEventManager.shared().currentAppleEvent?
            .paramDescriptor(forKeyword: AEKeyword(kAEQuitReason))?.typeCodeValue
        let window = mattstackWindow?.window
        let windowOnScreen = (window?.isVisible ?? false) || (window?.isMiniaturized ?? false)
        if QuitReason.shouldTerminate(quitConfirmed: quitConfirmed, sessionEnding: systemSessionEnding,
                                      reasonCode: reasonCode, windowOnScreen: windowOnScreen) {
            return .terminateNow
        }
        Task { @MainActor in
            if let controller = self.windowModel?.controller {
                controller.close()
            } else {
                self.mattstackWindow?.close()
            }
        }
        return .terminateCancel
    }

    @MainActor
    private func buildServices() {
        permissionsService = PermissionsService(bundleId: Bundle.main.bundleIdentifier ?? "com.mattstack.app",
                                                agentStatuses: { [weak self] in self?.servicesRegistrar.smStatuses() ?? [] },
                                                runner: SystemCommandRunner())
        servicesRegistrar = ServicesRegistrar(bundlePath: Bundle.main.bundlePath, runner: SystemCommandRunner())
        daemonLifecycle.services = servicesRegistrar
        servicesRegistrar.onHandDeckBlocked = { TrayState.shared.handDeckBlocked = $0 }
        let privileged = PrivilegedInstaller(bundlePath: Bundle.main.bundlePath, escalator: AuthorizationServicesEscalator())
        // Stub mode never lets a real provider reach a mutating/probing call.
        #if DEBUG
        let servicesForNeeds: ServicesProviding = BundleFlavor.isStubActive ? StubServicesProvider() : servicesRegistrar
        let privilegedForNeeds: PrivilegedInstalling = BundleFlavor.isStubActive ? StubPrivilegedInstaller() : privileged
        let permissionProbe: PermissionProbing? = BundleFlavor.isStubActive ? StubPermissionProbe() : nil
        #else
        let servicesForNeeds: ServicesProviding = servicesRegistrar
        let privilegedForNeeds: PrivilegedInstalling = privileged
        let permissionProbe: PermissionProbing? = nil
        #endif
        needBroker = NeedBroker(services: servicesForNeeds, privileged: privilegedForNeeds)
        let model = WindowModel()
        windowModel = model
        mattstackWindow = MattstackWindowController(model: model)
        // Warmed at launch, not at first show: a handoff POST that arrives
        // before the window has ever opened would otherwise wait out this
        // fetch and blow the caller's 300ms budget, which fails open and
        // serves the page in the browser instead.
        Task { await model.ensureCatalogLoaded() }
        let poller = BadgePoller(model: model)
        badgePoller = poller
        poller.start()
        let windowBridge = WindowOpenBridge()
        windowBridge.appDelegate = self
        notificationManager.appDelegate = self
        // Assigned here, in buildServices(), and not in setupTrayServer():
        // applicationDidFinishLaunching runs buildServices() before it starts
        // the listener, so no connection can arrive while `routes` is still
        // nil and fall through to the legacy 404 handler.
        TrayServer.shared.routes = TrayRoutes(permissions: permissionsService, services: servicesForNeeds, privileged: privilegedForNeeds,
                                              needs: needBroker, updater: updater, version: self, window: windowBridge)
        rtClient = RtClientFactory.make()
        if let rt = rtClient {
            coordinator = SetupCoordinator(rt: rt, permissions: permissionsService, permissionProbe: permissionProbe, needs: needBroker, updater: updater)
            if let code = pendingJoinCode {
                pendingJoinCode = nil
                coordinator?.handleJoin(code: code)
            }
        } else if pendingJoinCode != nil {
            pendingJoinCode = nil
            TrayLog.warn("mattstack://join link received but rt could not be resolved; dropping")
        }
        if let request = pendingOpen {
            pendingOpen = nil
            Task { @MainActor in
                let opened = await model.open(request)
                if !opened {
                    model.controller?.show()
                    TrayLog.warn("unknown app", ["app": request.app])
                }
            }
        }
        updaterObservation = updater.observe(\.canCheckForUpdates, options: [.initial, .new]) { u, _ in
            DispatchQueue.main.async { TrayState.shared.canCheckForUpdates = u.canCheckForUpdates }
        }
    }

    /// The machine store learns where this bundle lives, every launch — rt
    /// owns the store, so the app only ever writes through `rt settings set`.
    private func recordAppPath() async {
        guard let rt = rtClient else { return }
        do {
            let r = try await rt.run(AppPathSetting.arguments(bundlePath: Bundle.main.bundlePath), stdin: nil)
            if r.exitCode != 0 {
                TrayLog.warn("mattstack.appPath write failed", ["exit": Int(r.exitCode), "err": r.userError?.message ?? r.failureCopy(verb: "settings set")])
            }
        } catch {
            TrayLog.warn("mattstack.appPath write failed to start", ["err": (error as? RtClientError)?.copy ?? "rt settings set failed to start."])
        }
    }

    /// AppKit routes a key equivalent only when a menu item claims it, so an
    /// LSUIElement app's menu has to carry them itself: ⌘, for Settings, and
    /// ⌘W / ⌘M for the key window, which otherwise do nothing at all.
    private func installMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        let settingsItem = appMenu.addItem(withTitle: "Settings…", action: #selector(showSettings), keyEquivalent: ",")
        settingsItem.setAccessibilityIdentifier(AXID.menuAppSettings)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit mattstack", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.addItem(.separator())
        edit.addItem(FindMenu.submenuItem())
        editItem.submenu = edit
        let windowItem = NSMenuItem(); main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu = windowMenu
        NSApp.mainMenu = main
    }

    /// Gatekeeper's translocation and a DMG mount both make SMAppService and
    /// Sparkle unusable — the only recovery is a real, on-disk copy.
    private func showMoveToApplicationsAlert() {
        let alert = NSAlert()
        alert.messageText = "Move mattstack to Applications"
        alert.informativeText = "mattstack is running from a disk image or a temporary location, so it can't register its background services. Drag mattstack.app to /Applications (or ~/Applications) and open it from there."
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApp.terminate(nil)
    }

    @objc private func handleGetURL(_ event: NSAppleEventDescriptor, with reply: NSAppleEventDescriptor) {
        guard let s = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let url = URL(string: s) else { return }
        if let code = JoinLink.code(from: url) {
            Task { @MainActor in
                guard let coordinator else {
                    // Launch-by-link: the kAEGetURL event can arrive before
                    // buildServices() constructs the coordinator. buildServices()
                    // drains this once it exists.
                    pendingJoinCode = code
                    return
                }
                coordinator.handleJoin(code: code)
            }
            return
        }
        if let request = OpenLink.request(from: url) ?? OpenLink.request(fromHTTPS: url) {
            Task { @MainActor in
                guard let windowModel else { pendingOpen = request; return }
                let opened = await windowModel.open(request)
                if !opened {
                    windowModel.controller?.show()
                    TrayLog.warn("unknown app", ["app": request.app])
                }
            }
            return
        }
        if url.scheme == "https" || url.scheme == "http" {
            // Delivered an https URL we don't own (a router misfire): punt to
            // the default browser rather than swallowing it. Loop invariant:
            // never forward to whichever app macOS would hand this URL back
            // to -- registering as an https/http handler means that app can
            // be us (set as default browser, or an over-broad router rule),
            // and forwarding to ourselves would re-enter this same handler.
            if NSWorkspace.shared.urlForApplication(toOpen: url) == Bundle.main.bundleURL {
                TrayLog.warn("dropped https URL that would route back to mattstack", ["scheme": url.scheme ?? "", "host": url.host ?? ""])
                return
            }
            NSWorkspace.shared.open(url)
            return
        }
        // Never the raw string: an unrecognized URL can carry a malformed invite code in its path.
        TrayLog.warn("ignored URL", ["scheme": url.scheme ?? "", "host": url.host ?? ""])
    }

    /// NotificationManager's click handler calls this for a URL that parsed
    /// as a mattstack app link -- same routing as handleGetURL's open branch
    /// above (the pendingOpen queue included, for the same launch-by-link
    /// race, even though a notification click realistically can't arrive
    /// before buildServices() since nothing can fire a notification before
    /// setupNotifications() runs there too).
    func routeNotificationOpen(_ request: OpenRequest) {
        Task { @MainActor in
            guard let windowModel else { pendingOpen = request; return }
            let opened = await windowModel.open(request)
            if !opened {
                windowModel.controller?.show()
                TrayLog.warn("unknown app", ["app": request.app])
            }
        }
    }

    /// The tray menu's and gear menu's "Open mattstack" both post
    /// `.showMattstackWindow` and land here: always show(), never toggle --
    /// toggling is reserved for the global hotkey alone, or "Open mattstack"
    /// would sometimes close the window instead of raising it. Mirrors
    /// applicationShouldHandleReopen's same weak-controller fallback.
    @objc private func showMattstackWindow() {
        Task { @MainActor in
            if let controller = self.windowModel?.controller {
                controller.show()
            } else {
                self.mattstackWindow?.show()
            }
        }
    }
    private var suppressReopenShowUntil: Date = .distantPast

    /// NotificationManager calls this just before following a pane-bound
    /// click route, so the activation that click causes does not also
    /// raise the shell window.
    func suppressReopenShow(for seconds: TimeInterval) {
        suppressReopenShowUntil = Date().addingTimeInterval(seconds)
    }

    @objc private func handleSystemSessionEnding() { systemSessionEnding = true }
    @objc private func showSetupStatus() { Task { @MainActor in coordinator?.openSetupStatus() } }
    @objc private func showSettings() { Task { @MainActor in coordinator?.showSettings() } }
    @objc private func showUninstall() { Task { @MainActor in coordinator?.showSettings(pane: .uninstall) } }
    @objc private func showSettingsTeam() { Task { @MainActor in coordinator?.showSettings(pane: .team) } }

    func applicationWillTerminate(_ notification: Notification) {
        statusTimer?.invalidate()
        notificationTimer?.invalidate()
        TrayServer.shared.stop()
    }

    // MARK: - Login Item

    /// Idempotent start-at-login registration (spec MAT-383 §3).
    ///
    /// A flavor switch installs a DIFFERENT bundle id, so the outgoing
    /// flavor's login item does nothing for the incoming one — without this
    /// the user has to re-toggle "Start at Login" by hand after every switch.
    ///
    /// The user's own choice still wins: the panel toggle records an opt-out
    /// when they switch it OFF, and an explicitly disabled login item is
    /// never re-enabled here. Only `.notRegistered` is acted on —
    /// `.requiresApproval` is the user's pending decision in System Settings
    /// and re-registering would not change it.
    private func autoRegisterLoginItem() {
        guard !BundleFlavor.isStubActive else {
            TrayLog.info("login item auto-register skipped (stub mode)")
            return
        }
        guard !LoginItemPreference.isOptedOut else {
            TrayLog.info("login item auto-register skipped (user opted out)")
            return
        }
        let status = SMAppService.mainApp.status
        guard status == .notRegistered else { return }
        do {
            try SMAppService.mainApp.register()
            TrayLog.info("login item auto-registered",
                         ["status": TrayServer.statusName(SMAppService.mainApp.status)])
        } catch {
            TrayLog.error("login item auto-register failed", ["err": String(describing: error)])
        }
    }

    // MARK: - Menu Bar Setup

    private func setupMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateMenuBarTitle(status: .unknown)

        // Dock-first tray (spec 2026-09-15): assigning `.menu` makes AppKit
        // show it on any click, left or right, on its own -- no button
        // action/target of our own needed, unlike the old popover-toggle.
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = self
        statusItem.menu = menu
    }

    /// Rebuilt from scratch on every `menuNeedsUpdate` (right before the
    /// tray menu is shown) so the daemon-status line, the Start at Login
    /// checkmark, and the Check for Updates title are never stale --
    /// mirrors `ProcessPanelView.makeGearMenu()`'s same fresh-build-per-open
    /// approach, which still owns the panel's own gear menu unchanged.
    @MainActor
    private func rebuildTrayMenu(_ menu: NSMenu) {
        menu.removeAllItems()
        // Key equivalent is display-only here (a status-item menu's items
        // aren't live key equivalents unless the menu is open) -- it mirrors
        // HotkeyManager's actual ctrl-opt-cmd-M registration so the label
        // never drifts from the real hotkey.
        menu.addItem(ActionMenuItem("Open mattstack", axid: AXID.trayOpen,
                                    keyEquivalent: "m", keyEquivalentModifierMask: [.control, .option, .command]) {
            NotificationCenter.default.post(name: .showMattstackWindow, object: nil)
        })
        menu.addItem(.separator())
        let status = NSMenuItem(title: TrayState.shared.statusText, action: nil, keyEquivalent: "")
        status.isEnabled = false
        status.setAccessibilityIdentifier(AXID.trayStatus)
        menu.addItem(status)
        menu.addItem(.separator())
        menu.addItem(ActionMenuItem("Processes…", axid: AXID.trayProcesses) { [weak self] in
            self?.detachProcessPanel()
        })
        menu.addItem(.separator())
        menu.addItem(ActionMenuItem("Restart Daemon", axid: AXID.trayRestartDaemon) {
            NotificationCenter.default.post(name: .rtRestartDaemon, object: nil)
        })
        menu.addItem(ActionMenuItem("View Logs…", axid: AXID.trayViewLogs) {
            NotificationCenter.default.post(name: .rtViewDaemonLogs, object: nil)
        })
        menu.addItem(ActionMenuItem("Settings…", axid: AXID.traySettings) {
            NotificationCenter.default.post(name: .rtShowSettings, object: nil)
        })
        menu.addItem(.separator())
        let startAtLogin = SMAppService.mainApp.status == .enabled
        menu.addItem(ActionMenuItem("Start at Login", state: startAtLogin ? .on : .off, axid: AXID.trayStartAtLogin) { [weak self] in
            self?.toggleTrayStartAtLogin()
        })
        let updateItem = ActionMenuItem(trayUpdateMenuTitle, axid: AXID.trayCheckForUpdates) {
            NotificationCenter.default.post(name: .rtCheckUpdates, object: nil)
        }
        updateItem.isEnabled = TrayState.shared.canCheckForUpdates || TrayState.shared.updateAvailable != nil
        menu.addItem(updateItem)
        menu.addItem(.separator())
        menu.addItem(ActionMenuItem("Quit mattstack", axid: AXID.trayQuit) { [weak self] in
            self?.quitFromTray()
        })
    }

    @MainActor
    private var trayUpdateMenuTitle: String {
        if let tag = TrayState.shared.updateAvailable {
            return "Update Available: \(tag)"
        }
        return "Check for Updates…"
    }

    /// Mirrors `ProcessPanelView.toggleStartAtLogin()`'s exact opt-out
    /// bookkeeping (see that method's doc comment) for the tray-level copy
    /// of the same control; the panel's own gear menu keeps its copy as-is.
    private func toggleTrayStartAtLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
                LoginItemPreference.isOptedOut = true
            } else {
                try SMAppService.mainApp.register()
                LoginItemPreference.isOptedOut = false
            }
        } catch {
            TrayLog.error("login item toggle failed", ["err": String(describing: error)])
        }
    }

    /// The only real quit (dock-first spec 2026-09-15): every other path to
    /// termination is intercepted by `applicationShouldTerminate`.
    @objc private func quitFromTray() {
        quitConfirmed = true
        NSApp.terminate(nil)
    }

    /// Update the menu bar button with "m" text + colored status dot.
    private func updateMenuBarTitle(status: DaemonHealth) {
        guard let button = statusItem.button else { return }

        let dotColor: NSColor
        switch status {
        case .healthy:
            dotColor = .systemGreen
        case .starting:
            dotColor = .systemYellow
        case .warning:
            dotColor = .systemOrange
        case .degraded:
            dotColor = .systemPink
        case .down:
            dotColor = .systemRed
        case .unknown:
            dotColor = .tertiaryLabelColor
        }

        let attributed = NSMutableAttributedString()

        // "m" in monospace — matches the app icon's wordmark
        let mAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .medium),
            .foregroundColor: NSColor.labelColor,
        ]
        attributed.append(NSAttributedString(string: "m", attributes: mAttrs))

        // Stacked-layers mark trailing the "m" — the SF Symbol closest to the
        // app icon's lucide "layers" glyph. Embedded as a text attachment so
        // it sits between the wordmark and the dev tag / status dot; palette
        // labelColor keeps it tracking menu bar light/dark like the "m" (the
        // flavor colors belong to the app icon only).
        if let symbol = NSImage(systemSymbolName: "square.3.layers.3d", accessibilityDescription: "stack")
            ?? NSImage(systemSymbolName: "square.stack.3d.up", accessibilityDescription: "stack") {
            let config = NSImage.SymbolConfiguration(pointSize: 10, weight: .medium)
                .applying(NSImage.SymbolConfiguration(paletteColors: [.labelColor]))
            let attachment = NSTextAttachment()
            attachment.image = symbol.withSymbolConfiguration(config) ?? symbol
            let mark = NSMutableAttributedString(attributedString: NSAttributedString(attachment: attachment))
            mark.addAttribute(.baselineOffset, value: -0.5, range: NSRange(location: 0, length: mark.length))
            attributed.append(NSAttributedString(string: " "))
            attributed.append(mark)
        }

        // Dev flavor wears a visible mark (spec MAT-383 §3) — the dev and
        // prod trays are otherwise identical in the menu bar, and mistaking
        // one for the other is how you debug the wrong daemon.
        if BundleFlavor.isDevBuild {
            let devAttrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedSystemFont(ofSize: 9, weight: .semibold),
                .foregroundColor: NSColor.systemOrange,
            ]
            attributed.append(NSAttributedString(string: " dev", attributes: devAttrs))
        }

        // Space
        attributed.append(NSAttributedString(string: " "))

        // Colored dot
        let dotAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 8),
            .foregroundColor: dotColor,
        ]
        attributed.append(NSAttributedString(string: "●", attributes: dotAttrs))

        button.attributedTitle = attributed
    }

    // MARK: - Health Management

    @MainActor
    private func setHealth(_ health: DaemonHealth) {
        currentHealth = health
        updateMenuBarTitle(status: health)
        TrayState.shared.health = health
        switch health {
        case .starting:
            startingSince = Date()
            TrayState.shared.statusText = "Daemon: starting…"
            TrayState.shared.needsApproval = false
        case .down:
            switch daemonLifecycle.status {
            case .requiresApproval:
                TrayState.shared.statusText = "Daemon: needs approval in Login Items"
                TrayState.shared.bootVerdict = nil
            case .notRegistered, .notFound:
                TrayState.shared.statusText = "Daemon: not registered"
                TrayState.shared.bootVerdict = nil
            case .enabled:
                // launchd considers the job registered and enabled, yet
                // `ping` isn't answering — alive but not serving, the third
                // named verdict (S026), distinct from "not registered".
                TrayState.shared.statusText = "Daemon: alive but not serving"
                TrayState.shared.bootVerdict = "alive but not serving"
            default:
                TrayState.shared.statusText = "Daemon: not running"
                TrayState.shared.bootVerdict = nil
            }
            TrayState.shared.needsApproval = needsLoginItemApproval()
        default:
            break
        }
    }

    /// The worst status across every agent this bundle registers (daemon,
    /// deck, …), not just the daemon — a single-agent check would miss a
    /// second agent stuck in Login Items while the daemon itself is fine.
    private func needsLoginItemApproval() -> Bool {
        PermissionsService.combinedLoginItems(servicesRegistrar?.smStatuses() ?? []) == "requiresApproval"
    }

    // MARK: - Actions

    @objc private func restartDaemon() {
        Task { @MainActor in
            setHealth(.starting)

            // The op's own result is what makes the poll below meaningful: the
            // still-running OLD daemon answers isReachable too, so polling
            // after a failed or swallowed kickstart used to read as success.
            let ok = await daemonLifecycle.restartDaemon(origin: DaemonOrigin.menu)
            guard ok else {
                TrayLog.warn("menu restart failed; daemon not restarted")
                await refreshStatus()
                return
            }

            // Poll until it comes back (up to 8s)
            for _ in 0..<16 {
                try? await Task.sleep(nanoseconds: 500_000_000)
                if await daemonClient.isReachable() {
                    await refreshStatus()
                    return
                }
            }
            setHealth(.down)
        }
    }

    @objc private func stopDaemon() {
        Task { @MainActor in
            // Unregister from launchd — the agent has KeepAlive=true, so an
            // HTTP shutdown alone would be undone by a launchd restart.
            // Unregistering makes launchd SIGTERM the daemon and keep it down.
            await daemonLifecycle.stopDaemon(origin: DaemonOrigin.menu)
            try? await Task.sleep(nanoseconds: 500_000_000)
            setHealth(.down)
        }
    }

    /// Open the logdy-based daemon log viewer in the user's default browser.
    /// If logdy is already serving on :5544 AND we know it's still current
    /// (see `isLogdyStale`), just opens the URL. Otherwise kills whatever
    /// holds :5544 (a foreign or stale instance) and spawns `rt daemon logs`
    /// fresh via a login shell so it picks up the user's PATH (rt-tray
    /// inherits launchd's minimal PATH).
    @objc private func viewDaemonLogs() {
        let url = URL(string: "http://localhost:5544")!
        Task { @MainActor in
            let up = await self.isLogdyUp()
            if up && !self.isLogdyStale() {
                NSWorkspace.shared.open(url)
                return
            }
            if up {
                TrayLog.info("logdy on :5544 is stale or foreign; killing and respawning")
                self.killLogdy()
                // Give the port a moment to free before respawning.
                try? await Task.sleep(nanoseconds: 300_000_000)
            }
            self.spawnRtDaemonLogs()
            // Poll until logdy answers, up to ~4s, then open.
            for _ in 0..<20 {
                try? await Task.sleep(nanoseconds: 200_000_000)
                if await self.isLogdyUp() {
                    NSWorkspace.shared.open(url)
                    return
                }
            }
            // Fallback: open the URL anyway — user sees a connection error if
            // logdy never came up (e.g. logdy not installed).
            NSWorkspace.shared.open(url)
        }
    }

    /// True when the logdy this tray believes is running on :5544 can no
    /// longer be trusted to be tailing current files (S080): we never
    /// spawned it (a leftover from a previous tray process, or logdy started
    /// by hand), the daemon has restarted since we spawned it (its old log
    /// file set may be gone), or a day boundary has passed since we spawned
    /// it (logdy was launched against yesterday's dated log files and never
    /// picks up today's -- the exact "week-old logs" footgun on record).
    private func isLogdyStale() -> Bool {
        guard let spawnedAt = logdySpawnedAt, let spawnedDay = logdySpawnedDay else { return true }
        if let daemonStartedAt = lastKnownDaemonStartedAt, daemonStartedAt > spawnedAt { return true }
        if spawnedDay != Self.dayString(for: Date()) { return true }
        return false
    }

    /// Kill whatever holds :5544 -- port 5544 exists only for this logdy
    /// viewer, so anything bound there is fair game to replace. Scoped to
    /// the TCP listener only (`-sTCP:LISTEN`): a bare `-ti:5544` also
    /// matches any client with an open connection TO that listener (e.g. a
    /// browser tab left on the logdy page), and `kill` on that PID would
    /// take out an unrelated process.
    private func killLogdy() {
        let script = "pids=$(/usr/sbin/lsof -nP -tiTCP:5544 -sTCP:LISTEN 2>/dev/null); if [ -n \"$pids\" ]; then kill $pids; fi"
        _ = TrayLog.runLogged("/bin/sh", ["-c", script], label: "kill stale logdy on :5544")
        logdySpawnedAt = nil
        logdySpawnedDay = nil
    }

    private static func dayString(for date: Date) -> String {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = TimeZone.current
        return df.string(from: date)
    }

    /// Probe localhost:5544 with a short TCP connect.
    private func isLogdyUp() async -> Bool {
        return await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            let conn = NWConnection(host: "127.0.0.1", port: 5544, using: .tcp)
            // Serialize resume checks — the state handler and the timeout run on
            // independent queues, and racing them can double-resume (a crash).
            let guardQueue = DispatchQueue(label: "rt.logdy-probe")
            var resumed = false
            let finish: (Bool) -> Void = { result in
                guardQueue.sync {
                    guard !resumed else { return }
                    resumed = true
                    conn.cancel()
                    cont.resume(returning: result)
                }
            }
            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    finish(true)
                case .failed:
                    finish(false)
                default: break
                }
            }
            conn.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) {
                finish(false)
            }
        }
    }

    /// Spawn `rt daemon logs` detached. Uses the installed CLI at
    /// ~/.local/bin/rt (the dev app's source wrapper, or the prod binary), else this
    /// bundle's own embedded daemon binary, else a login-shell PATH lookup.
    ///
    /// Logdy stays running in the background after this method returns;
    /// it's killed only if the user Ctrl-Cs the spawned rt OR the rt-tray
    /// app group is terminated.
    private func spawnRtDaemonLogs() {
        let home = AppHome.current
        let candidates = [
            "\(home)/.local/bin/rt",
            Bundle.main.bundlePath + "/Contents/MacOS/rt",
        ]
        let rtBin = candidates.first { FileManager.default.isExecutableFile(atPath: $0) }

        let task = Process()
        if let rtBin = rtBin {
            task.executableURL = URL(fileURLWithPath: rtBin)
            task.arguments = ["daemon", "logs"]
        } else {
            // Last-resort PATH lookup via login shell.
            task.executableURL = URL(fileURLWithPath: "/bin/zsh")
            task.arguments = ["-lc", "exec rt daemon logs"]
            TrayLog.warn("no rt binary found in known locations; falling back to PATH lookup")
        }
        TrayLog.spawnLoggedDetached(task, label: "rt daemon logs")
        let now = Date()
        logdySpawnedAt = now
        logdySpawnedDay = Self.dayString(for: now)
    }

    /// Open whichever crash/panic log is actually current (S029). Neither
    /// `daemon-stderr.log` (native panic capture, written by the TS daemon
    /// and the dev daemon shim) nor `tray-crash.log` (this app's own signal
    /// handler, `installTrayCrashHandlers`) is date-rotated on the writer
    /// side within this job's write fence, so a months-old panic can sit in
    /// either file forever. Reading `resolveCurrentCrashLogPath` gates each
    /// candidate on its mtime being newer than the relevant process's start
    /// time, so a stale leftover never passes for "the current crash" --
    /// falling back to Finder on the logs directory when neither qualifies.
    @objc private func openCrashLog() {
        guard let path = resolveCurrentCrashLogPath() else {
            NSWorkspace.shared.open(URL(fileURLWithPath: AppHome.current + "/.mattstack/rt/logs"))
            return
        }
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    private func resolveCurrentCrashLogPath() -> String? {
        let logDir = AppHome.current + "/.mattstack/rt/logs"
        let fm = FileManager.default

        func freshMtime(_ path: String, after cutoff: Date?) -> Date? {
            guard let attrs = try? fm.attributesOfItem(atPath: path),
                  let mtime = attrs[.modificationDate] as? Date else { return nil }
            if let cutoff, mtime <= cutoff { return nil }
            return mtime
        }

        var candidates: [(path: String, mtime: Date)] = []
        let daemonStderr = logDir + "/daemon-stderr.log"
        // freshMtime's `after` cutoff is a no-op when nil (nothing to compare
        // against), so without a known daemon-start time it would accept ANY
        // existing daemon-stderr.log -- including a stale crash left over
        // from a much earlier daemon run. Require the cutoff before this
        // candidate is even considered.
        if let daemonStartedAt = lastKnownDaemonStartedAt,
           let mtime = freshMtime(daemonStderr, after: daemonStartedAt) {
            candidates.append((daemonStderr, mtime))
        }
        let trayCrash = logDir + "/tray-crash.log"
        if let mtime = freshMtime(trayCrash, after: appLaunchedAt) {
            candidates.append((trayCrash, mtime))
        }
        return candidates.max(by: { $0.mtime < $1.mtime })?.path
    }

    @objc private func checkForUpdates() {
        updater.checkForUpdatesFromMenu()
    }

    @objc private func showProcessPanel() {
        if processPopover == nil {
            let popover = NSPopover()
            popover.contentSize = NSSize(width: 900, height: 600)
            popover.contentViewController = NSHostingController(rootView: ProcessPanelView())
            popover.behavior = .transient
            processPopover = popover
        }

        if let popover = processPopover {
            if popover.isShown {
                popover.performClose(nil)
            } else if let button = statusItem.button {
                NSApp.activate(ignoringOtherApps: true)
                popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
                popover.contentViewController?.view.window?.makeKey()
            }
        }
    }

    @objc private func detachProcessPanel() {
        processPopover?.performClose(nil)

        if let window = processWindow {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1000, height: 700),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "mattstack processes"
        window.contentViewController = NSHostingController(rootView: ProcessPanelView(isDetached: true))
        // Setting contentViewController shrinks the window to the SwiftUI
        // view's fitting size (its 600x400 minimum); re-apply the intended
        // size after. The autosave name then keeps the user's own size and
        // position across pop-outs, once one exists.
        window.setContentSize(NSSize(width: 1000, height: 700))
        window.center()
        window.setFrameAutosaveName("rt-process-panel")
        window.isReleasedWhenClosed = false
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        processWindow = window
    }

    // MARK: - Auto-Update

    private func setupAutoUpdate() {
        updater.onUpdateAvailable = { version in
            // UpdaterController always dispatches this callback on the main
            // queue, so bridge synchronously rather than hopping via Task.
            MainActor.assumeIsolated {
                TrayState.shared.updateAvailable = version.isEmpty ? nil : version
            }
        }
    }

    // MARK: - Polling

    private func startPolling() {
        statusTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { await self?.refreshStatus() }
        }

        notificationTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { await self?.drainPendingNotifications() }
        }
    }

    private var isRefreshing = false
    private var consecutiveStatusFailures = 0
    /// Stamped whenever `setHealth(.starting)` runs. `.starting` has no
    /// natural "it failed" signal of its own -- unlike `.down`, which the
    /// failed-poll count already demotes into -- so this is what lets
    /// `refreshStatus` recognize a launch or restart that never came back
    /// (S026) instead of leaving the tray yellow forever.
    private var startingSince: Date?
    /// Derived from the last successful poll's `uptime`; used to tell a
    /// stale crash/log artifact from a current one (S029) without needing
    /// to touch the daemon-side writer.
    private var lastKnownDaemonStartedAt: Date?
    /// When this tray last spawned `rt daemon logs`, and the calendar day it
    /// did so on -- nil whenever logdy wasn't spawned by this tray instance
    /// (see `isLogdyStale`, S080).
    private var logdySpawnedAt: Date?
    private var logdySpawnedDay: String?

    /// Main-actor so `isRefreshing` and all menu/UI mutations are serialized;
    /// the daemon queries themselves still run off-main across the awaits.
    @MainActor
    private func refreshStatus() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        guard let status = await daemonClient.queryTrayStatus() else {
            consecutiveStatusFailures += 1

            if currentHealth == .starting {
                // `.starting` has no bounded fallback of its own (S026): a
                // daemon that's crash-looping, parked on a flavor mismatch,
                // or stuck in Login Items "requiresApproval" would otherwise
                // never demote out of the yellow "starting…" state, since
                // every poll failure short-circuited here unconditionally.
                // Expire it after ~30s (or 3 failed polls, whichever comes
                // first at the 10s poll interval) and fall through to the
                // normal down-state handling below, which also recomputes
                // needsApproval.
                let elapsed = startingSince.map { Date().timeIntervalSince($0) } ?? .infinity
                guard elapsed >= 30 || consecutiveStatusFailures >= 3 else { return }
                TrayLog.warn("daemon still unreachable after starting; marking down", [
                    "elapsedSeconds": Int(elapsed), "failures": consecutiveStatusFailures,
                    "smStatus": String(describing: daemonLifecycle.status),
                ])
                setHealth(.down)
                return
            }

            // A single missed poll is usually a transient daemon stall, not an
            // outage — hold the last known state and only go red on the second
            // consecutive miss.
            guard consecutiveStatusFailures >= 2 else { return }
            if currentHealth != .down {
                TrayLog.warn("daemon unreachable, marking down", ["failures": consecutiveStatusFailures])
            }
            setHealth(.down)
            return
        }
        if consecutiveStatusFailures >= 2 {
            TrayLog.info("daemon reachable again", ["failures": consecutiveStatusFailures])
        }
        consecutiveStatusFailures = 0

        var health: DaemonHealth = status.pendingNotifications > 0 ? .warning : .healthy

        if let procData = await daemonClient.querySystemProcesses() {
            if procData.processes.contains(where: { $0.isRunaway }) {
                health = .warning
            }
        }

        // Phase 2 health level: a degraded/unhealthy daemon-reported level
        // outranks the local heuristics above — it names the actual failing
        // subsystem instead of leaving the operator to guess from a color.
        var failingSubsystem: String?
        if let level = status.healthLevel, level != "ok" {
            health = .degraded
            failingSubsystem = status.healthReasons.first ?? level
        }

        lastKnownDaemonStartedAt = Date().addingTimeInterval(-Double(status.uptime) / 1000)

        currentHealth = health
        updateMenuBarTitle(status: health)
        TrayState.shared.health = health
        TrayState.shared.failingSubsystem = failingSubsystem
        if let failingSubsystem {
            TrayState.shared.statusText = "Daemon: degraded — \(failingSubsystem)"
        } else {
            TrayState.shared.statusText = "Daemon: running · pid \(status.pid) · \(formatUptime(status.uptime))"
        }
        // The daemon being reachable only proves the daemon's own agent is
        // approved — another registered agent (deck) can still be pending.
        TrayState.shared.needsApproval = needsLoginItemApproval()

        updateReadyHeld(status.readyHeld)

        await refreshBootDiagnostics()
    }

    /// Persisted so a tray relaunch does not re-announce a hold the operator
    /// has already seen; the notifier's re-arm interval, not a restart, is what
    /// brings a standing hold back.
    private static let readyHeldLedgerKey = "readyHeldLedger"

    /// Badge the held repos and announce the ones not yet announced (RT-98).
    @MainActor
    private func updateReadyHeld(_ held: [ReadyHeldRepo]) {
        TrayState.shared.readyHeldRepos = held

        let defaults = UserDefaults.standard
        let stored = defaults.dictionary(forKey: Self.readyHeldLedgerKey) as? [String: Date] ?? [:]
        let outcome = ReadyHeldNotifier.decide(held: held, ledger: stored, now: Date())
        defaults.set(outcome.ledger, forKey: Self.readyHeldLedgerKey)

        for repo in outcome.notify {
            TrayLog.warn("worktree ready ladder held pending approval", [
                "repo": repo.label, "hash": repo.hash,
            ])
            notificationManager.fireReadyHeld(repo)
        }
    }

    /// Restart count, last-crash reason, and boot verdict (S026) — a separate
    /// query from the main status poll since this data only lives on the
    /// `ping` reply (see `DaemonClient.querySupervision`), not `tray:status`.
    /// Best-effort: a nil result just means the gear menu shows no boot info,
    /// same as before this feature existed.
    ///
    /// Main-actor because the `TrayState.shared` writes below publish into
    /// SwiftUI: without the annotation this non-isolated async body runs on
    /// the cooperative pool (SE-0338) even when called from a main-actor
    /// caller, and the off-main `objectWillChange` drove `NSOutlineView
    /// reloadData` on a pool thread — a recurring SIGABRT in AppKit's
    /// layout engine.
    @MainActor
    private func refreshBootDiagnostics() async {
        guard let supervision = await daemonClient.querySupervision() else { return }
        TrayState.shared.restartCount = supervision.bootAttempts
        let now = Date()
        if let (verdict, reason) = bootVerdict(from: supervision, now: now) {
            TrayState.shared.bootVerdict = verdict
            TrayState.shared.lastCrashReason = reason
        } else {
            TrayState.shared.bootVerdict = nil
            TrayState.shared.lastCrashReason = supervision.lastExit?.reason
        }
    }

    private func drainPendingNotifications() async {
        guard let events = await daemonClient.fetchNotifications() else { return }
        for event in events {
            notificationManager.fire(event)
        }
    }

    // MARK: - Notifications Setup

    private func setupNotifications() {
        notificationManager.requestPermission()
        notificationManager.registerCategories()
    }

    // MARK: - Tray Server (receives daemon pushes)

    private func setupTrayServer() {
        TrayServer.shared.onNotification = { [weak self] event in
            self?.notificationManager.fire(event)
        }
        TrayServer.shared.daemonLifecycle = daemonLifecycle
        TrayServer.shared.start()
    }

    // MARK: - Keyboard Conflict

    private func checkMissionControlConflict() {
        guard !MissionControlCheck.hasShownNotification else { return }
        guard MissionControlCheck.isControlUpBoundToMissionControl() else { return }

        TrayLog.info("Mission Control has Control+Up bound -- firing keyboard-conflict notification")

        let content = UNMutableNotificationContent()
        content.title = "Keyboard Shortcut Conflict"
        content.body = "Control+Up is reserved by Mission Control. rt needs this key for navigation."
        content.sound = nil
        content.categoryIdentifier = "keyboard_conflict"
        NotificationManager.playSound(for: "keyboard_conflict")

        let request = UNNotificationRequest(
            identifier: "rt-keyboard-conflict",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    @objc private func showKeyboardConflictWindow() {
        if let window = keyboardConflictWindow {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let window = NSWindow(
            contentRect: .zero,
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "mattstack -- Keyboard Shortcut Conflict"
        let hostingController = NSHostingController(rootView: KeyboardConflictView())
        window.contentViewController = hostingController

        // Let SwiftUI determine the content size, then position
        let fittingSize = hostingController.view.fittingSize
        window.setContentSize(fittingSize)

        if let screen = NSScreen.main {
            let visibleFrame = screen.visibleFrame
            let x = visibleFrame.midX - fittingSize.width / 2
            let y = visibleFrame.maxY - (visibleFrame.height * 0.17) - fittingSize.height
            window.setFrameOrigin(NSPoint(x: x, y: y))
        } else {
            window.center()
        }
        window.isReleasedWhenClosed = false
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        keyboardConflictWindow = window
    }

    // MARK: - Helpers

    private func formatUptime(_ ms: Int) -> String {
        let seconds = ms / 1000
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        let remainingMinutes = minutes % 60
        return "\(hours)h \(remainingMinutes)m"
    }
}

extension AppDelegate: NSMenuDelegate {
    /// The documented hook for mutating a menu's contents right before
    /// AppKit shows it -- rebuilds the tray menu fresh every open the same
    /// way `menuWillOpen` would, just earlier in the show sequence.
    func menuNeedsUpdate(_ menu: NSMenu) {
        // AppKit delivers menu-delegate callbacks on the main thread.
        MainActor.assumeIsolated { rebuildTrayMenu(menu) }
    }
}

extension AppDelegate: VersionProviding {
    /// `build` is the numeric CFBundleVersion L4 writes — major*1e6 +
    /// minor*1e3 + patch (e.g. 2.8.0 → 2008000) — never a string; a
    /// non-numeric or missing value reads as 0, but never silently: a build
    /// pipeline that regresses to a dotted string should show up in logs,
    /// not just as a suspiciously-always-0 build number.
    func versionInfo() -> VersionInfo {
        let raw = Bundle.main.infoDictionary?["CFBundleVersion"] as? String
        let build = raw.flatMap(Int.init) ?? {
            TrayLog.warn("CFBundleVersion not numeric", ["value": raw ?? "(missing)"])
            return 0
        }()
        return VersionInfo(version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev",
                           build: build,
                           flavor: BundleFlavor.isDevBuild ? "dev" : "prod",
                           path: Bundle.main.bundlePath)
    }
}

// MARK: - Types

enum DaemonHealth {
    case healthy    // Green dot — daemon running, all good
    case starting   // Yellow dot — daemon is starting/restarting
    case warning    // Orange dot — running but has pending notifications
    case degraded   // Pink dot — daemon reports health.level != "ok" (a named subsystem cause, not a guess)
    case down       // Red dot — daemon not reachable
    case unknown    // Grey dot — initial state before first poll
}

/// Classifies a `SupervisionInfo` reading into one of the two verdicts
/// observable while the daemon is still answering `ping` (a successful
/// `querySupervision` already proves it's alive and serving) -- mirrors
/// `classifyDaemonStatus`'s crash-looping/boot-failed branches in
/// `lib/daemon-status.ts` at the same n=3-within-5-minutes threshold as
/// `isCrashLooping` (`lib/daemon/supervision-state.ts`). The third named
/// verdict, "alive but not serving", only applies once `ping` itself fails
/// (see `setHealth`'s `.down` branch) and so can't be reached here.
private func bootVerdict(from info: SupervisionInfo, now: Date) -> (verdict: String, reason: String)? {
    let windowMs: Double = 5 * 60_000
    let floorMs = now.timeIntervalSince1970 * 1000 - windowMs
    let recentCount = info.recentFailures.filter { Double($0.at) > floorMs }.count

    if recentCount >= 3 {
        let reason = info.lastExit?.kind == "boot-failed"
            ? (info.lastExit?.reason ?? "unknown")
            : (info.recentFailures.last?.reason ?? "unknown")
        return ("crash-looping", reason)
    }
    if info.lastExit?.kind == "boot-failed" {
        return ("boot-failed", info.lastExit?.reason ?? "unknown")
    }
    return nil
}

final class WindowOpenBridge: WindowOpening, @unchecked Sendable {
    weak var appDelegate: AppDelegate?
    func open(url: String) async -> Bool {
        let defaults = UserDefaults.standard
        let enabled = defaults.object(forKey: "MSShellHandoff") == nil || defaults.bool(forKey: "MSShellHandoff")
        guard enabled, let u = URL(string: url), let request = OpenLink.request(fromHTTPS: u) else { return false }
        return await MainActor.run { [weak appDelegate] () -> Task<Bool, Never>? in
            guard let model = appDelegate?.windowModel else { return nil }
            return Task { await model.open(request) }
        }?.value ?? false
    }
}

struct DaemonStatus {
    let pid: Int
    let uptime: Int
    let memoryUsage: Int
    let watchedRepos: Int
    let cacheEntries: Int
    let portsCached: Int
    let portsByRepo: [String: Int]
    let pendingNotifications: Int
    let lastRefresh: Int?
    /// "ok" / "degraded" / "unhealthy", nil if the daemon didn't report one.
    let healthLevel: String?
    let healthReasons: [String]
    /// Repos whose team `ready` ladder is held pending approval (RT-98).
    let readyHeld: [ReadyHeldRepo]
}
