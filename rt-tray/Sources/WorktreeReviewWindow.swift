import AppKit
import SwiftUI
import MattstackCore

/// One window serves every row: reviewing another row retargets it and keeps
/// the user's frame.
@MainActor
final class WorktreeReviewWindow: NSObject, NSWindowDelegate {
    static let shared = WorktreeReviewWindow()
    private var window: NSWindow?
    private var host: NSHostingController<AnyView>?

    func show(_ row: TriageRow, controller: WorktreePanelController, onStart: @escaping (String) -> Void) {
        // A fresh identity per show, never `row.id`: reviewing the same row
        // again must reload its diff, or Discard would act on files it never showed.
        let root = AnyView(WorktreeReviewSheet(row: row, controller: controller, onStart: onStart,
                                               onClose: { [weak self] in self?.close() }).id(UUID()))
        let w = window ?? make()
        host?.rootView = root
        w.title = "Review \(row.tree)"
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func close() { window?.close() }

    func windowWillClose(_ notification: Notification) {
        host?.rootView = AnyView(EmptyView())
    }

    private func make() -> NSWindow {
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 760),
                         styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        w.backgroundColor = WT.cardNS
        w.titlebarAppearsTransparent = true
        w.titleVisibility = .hidden
        let host = NSHostingController(rootView: AnyView(EmptyView()))
        host.sizingOptions = [.minSize]
        w.contentViewController = host
        // Same shrink-to-fitting-size trap as `detachProcessPanel`.
        w.setContentSize(NSSize(width: 960, height: 760))
        w.center()
        w.setFrameAutosaveName("rt-worktree-review")
        w.isReleasedWhenClosed = false
        w.delegate = self
        window = w
        self.host = host
        return w
    }
}
