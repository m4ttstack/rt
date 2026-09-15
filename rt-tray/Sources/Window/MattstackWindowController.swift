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
        if !restoredFrame { window.center() }
    }
    required init?(coder: NSCoder) { fatalError("not supported") }

    func show() {
        NSApp.setActivationPolicy(.regular)
        Task { await model.ensureCatalogLoaded() }
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
}
