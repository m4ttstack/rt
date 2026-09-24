import AppKit
import MattstackCore

// ─── Entry point ────────────────────────────────────────────────────────────

#if DEBUG
// Ahead of everything else on purpose: the self-check must not install crash
// handlers, write a log under ~/.rt, or race another tray for tray.sock.
if CommandLine.arguments.contains("--find-bar-self-check") {
    FindBarSelfCheck.run()
}
if let flag = CommandLine.arguments.firstIndex(of: "--find-bar-preview") {
    FindBarPreview.run(url: CommandLine.arguments.dropFirst(flag + 1).first)
}
if MainActor.assumeIsolated({ WorktreeSnapshot.runIfRequested() }) { exit(0) }
#endif

installTrayCrashHandlers()
TrayLog.info("tray launched", [
    "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev",
    "bundle": Bundle.main.bundleIdentifier ?? "(unbundled)",
    "daemonLabel": BundleFlavor.daemonLabel,
    "dev": BundleFlavor.isDevBuild,
])

// Mutual exclusion FIRST: a second instance of this app exits here, before
// AppDelegate runs and therefore before any SMAppService registration, since
// a loser that registered on its way out would leave a second daemon agent
// behind. The other flavor's live tray is left alone until the launch origin
// (known only inside applicationDidFinishLaunching) says whether this launch
// takes the Mac over or stands down.
switch TrayServer.launchSocketVerdict() {
case .claim:
    break
case .exitDoubleLaunch:
    exit(0)
case .otherFlavorHolds(let other):
    FlavorLaunchState.otherTrayAlive = other
    TrayLog.info("the other flavor's tray holds the socket", ["other": other])
}

let app = NSApplication.shared
// Regular from launch, overriding the bundle's LSUIElement: the Dock icon is
// the way in now, and a pinned icon that never shows its running dot reads as
// a dead shortcut. The tray menu stays the second door.
app.setActivationPolicy(.regular)

let delegate = AppDelegate()
app.delegate = delegate
app.run()
