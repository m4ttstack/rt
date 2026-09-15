import AppKit
import SwiftUI

final class MattstackWindowController: NSWindowController, NSWindowDelegate {
    let model: WindowModel
    private var hasStartedCatalogLoad = false

    init(model: WindowModel) {
        self.model = model
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("mattstack-window")
        super.init(window: window)
        window.delegate = self
        model.controller = self
        window.contentViewController = NSHostingController(rootView: MattstackWindowView(model: model))
    }
    required init?(coder: NSCoder) { fatalError("not supported") }

    func show() {
        NSApp.setActivationPolicy(.regular)
        if !hasStartedCatalogLoad {
            hasStartedCatalogLoad = true
            Task { await model.ensureCatalogLoaded() }
        }
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
}
