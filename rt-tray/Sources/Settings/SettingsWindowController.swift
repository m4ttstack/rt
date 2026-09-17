import AppKit
import SwiftUI
import Combine
import MattstackCore

enum SettingsPane: String, CaseIterable {
    case general, permissions, fastBrowser, team, uninstall

    var title: String {
        switch self {
        case .general: return "General"
        case .permissions: return "Permissions"
        case .fastBrowser: return "Fast Browser"
        case .team: return "Team"
        case .uninstall: return "Uninstall"
        }
    }

    var symbol: String {
        switch self {
        case .general: return "gearshape"
        case .permissions: return "lock.shield"
        case .fastBrowser: return "globe"
        case .team: return "person.3"
        case .uninstall: return "trash"
        }
    }
}

final class SettingsWindowController: NSWindowController, NSWindowDelegate {
    static let paneKey = "MSSettingsPane"
    let pane = PaneSelection()
    final class PaneSelection: ObservableObject { @Published var current: SettingsPane = .general }

    /// NSTabViewController with a selection callback: toolbar tab clicks are
    /// the one selection path this controller cannot originate, so they flow
    /// back through `onSelect` into the published pane.
    private final class TabsController: NSTabViewController {
        var onSelect: ((Int) -> Void)?
        override func tabView(_ tabView: NSTabView, didSelect tabViewItem: NSTabViewItem?) {
            super.tabView(tabView, didSelect: tabViewItem)
            if let tabViewItem { onSelect?(tabView.indexOfTabViewItem(tabViewItem)) }
        }
    }

    private let env: SettingsEnvironment
    private let tabs: TabsController
    private var paneObserver: AnyCancellable?
    /// This window's own half of the paired becameVisible/becameHidden
    /// calls into the shared `ReadinessModel` — tracked locally so a
    /// `becameHidden` (from `windowWillClose` or the pane sink) only ever
    /// fires when this controller actually holds a matching `becameVisible`,
    /// never a stray extra decrement.
    private var readinessIsVisible = false
    /// Whether `show()` has put the window on screen since the last close.
    /// The pane sink acts only while this is true, since `Published`'s
    /// publisher replays the just-restored pane synchronously on subscribe
    /// (init time, well before the window exists on screen) and would
    /// otherwise start the shared poller before anyone can see the row it
    /// probes.
    private var windowIsVisible = false

    init(env: SettingsEnvironment) {
        self.env = env
        tabs = TabsController()
        // The toolbar tab style is the native settings-window chrome:
        // standard-height titlebar, compact centered icon+label items.
        tabs.tabStyle = .toolbar
        for p in SettingsPane.allCases {
            let hosting = NSHostingController(rootView: SettingsPaneContent.view(for: p, env: env))
            // NSTabViewController propagates the selected child's title to the
            // window; an untitled child renders as "Untitled".
            hosting.title = p.title
            let item = NSTabViewItem(viewController: hosting)
            item.label = p.title
            item.image = NSImage(systemSymbolName: p.symbol, accessibilityDescription: p.title)
            item.identifier = AXID.settingsTab(p.rawValue)
            tabs.addTabViewItem(item)
        }

        let window = NSWindow(contentViewController: tabs)
        window.styleMask = [.titled, .closable]
        window.title = "mattstack Settings"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        tabs.onSelect = { [weak self] idx in
            guard let self, let p = SettingsPane.allCases[safe: idx], p != self.pane.current else { return }
            self.pane.current = p
        }
        pane.current = SettingsPane(rawValue: UserDefaults.standard.string(forKey: Self.paneKey) ?? "") ?? .general
        selectTab(pane.current)
        window.setContentSize(NSSize(width: 680, height: 620))
        window.center()
        paneObserver = pane.$current.sink { [weak self] p in
            guard let self else { return }
            self.selectTab(p)
            UserDefaults.standard.set(p.rawValue, forKey: Self.paneKey)
            guard self.windowIsVisible else { return }
            self.setReadinessVisible(p == .permissions)
        }
    }
    required init?(coder: NSCoder) { fatalError("not supported") }

    private func selectTab(_ p: SettingsPane) {
        guard let idx = SettingsPane.allCases.firstIndex(of: p), tabs.selectedTabViewItemIndex != idx else { return }
        tabs.selectedTabViewItemIndex = idx
    }

    func show(pane p: SettingsPane? = nil) {
        if let p { pane.current = p }
        UserDefaults.standard.set(pane.current.rawValue, forKey: Self.paneKey)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        window?.center()
        NSApp.activate(ignoringOtherApps: true)
        windowIsVisible = true
        // The pane sink doesn't re-emit on a reopen with an unchanged pane
        // (and was suppressed above while the window was still hidden), so
        // this is the only path that resumes the poller when reopening
        // straight onto the Permissions tab.
        setReadinessVisible(pane.current == .permissions)
    }

    private func setReadinessVisible(_ visible: Bool) {
        guard visible != readinessIsVisible else { return }
        readinessIsVisible = visible
        if visible { env.readiness.becameVisible() } else { env.readiness.becameHidden() }
    }

    func windowWillClose(_ notification: Notification) {
        windowIsVisible = false
        setReadinessVisible(false)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

struct SettingsEnvironment {
    let rt: RtRunning
    let permissions: PermissionsService
    let readiness: ReadinessModel
    let updater: UpdaterController
    let team: TeamSettingsModel
    let waivers: WaiverClient
    let isDevBuild: Bool
    let version: String
    let onJoinAnotherTeam: () -> Void
    let onQuitForUninstall: () -> Void
}
