import AppKit
import SwiftUI

private let frameAutosaveName = "mattstack-window"

final class MattstackWindowController: NSWindowController, NSWindowDelegate {
    let model: WindowModel

    init(model: WindowModel) {
        self.model = model
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        model.controller = self
        window.contentViewController = NSHostingController(rootView: MattstackWindowView(model: model))

        // shouldCascadeWindows defaults to true on NSWindowController and
        // overrides a frame set before super.init(window:) runs, so the
        // autosave name has to be armed here, after super.init, with
        // cascading off, or the saved frame never sticks.
        shouldCascadeWindows = false
        let restoredFrame = window.setFrameUsingName(frameAutosaveName)
        window.setFrameAutosaveName(frameAutosaveName)
        // NSHostingController sizes the window to its content's fitting size
        // on assignment above, which collapses an unrestored window (no
        // intrinsic width from the webview container) to a rail-width
        // sliver, so a first launch needs its content size re-applied here.
        if !restoredFrame {
            window.setContentSize(NSSize(width: 1280, height: 820))
            window.center()
        }
    }
    required init?(coder: NSCoder) { fatalError("not supported") }

    /// A ⌘F pressed with focus anywhere but the web content (a tab button,
    /// bare window chrome) never reaches the tab's FindBarContainer, so the
    /// controller catches it at the end of the chain and hands it to whatever
    /// tab is showing.
    override func performTextFinderAction(_ sender: Any?) {
        guard let tag = (sender as? NSValidatedUserInterfaceItem)?.tag,
              let action = NSTextFinder.Action(rawValue: tag),
              let container = model.activeFindContainer else { return }
        container.finder.performAction(action)
    }

    func show() {
        model.presentSplashIfNeeded()
        Task { await model.ensureCatalogLoaded() }
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

extension MattstackWindowController: NSUserInterfaceValidations {
    /// Find Next and Find Previous stay greyed out until a search string
    /// exists, the same as any other macOS find bar.
    func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        guard item.action == #selector(performTextFinderAction(_:)) else { return true }
        guard let action = NSTextFinder.Action(rawValue: item.tag),
              let container = model.activeFindContainer else { return false }
        return container.finder.validateAction(action)
    }
}
