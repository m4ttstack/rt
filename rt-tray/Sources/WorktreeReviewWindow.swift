import AppKit
import SwiftUI
import MattstackCore

/// Review opens in its own resizable window rather than a sheet, so a long
/// diff is not capped by the Worktrees window's size. One window serves every
/// row: reviewing another row retargets it and keeps the user's frame.
@MainActor
final class WorktreeReviewWindow {
    static let shared = WorktreeReviewWindow()
    private var window: NSWindow?
    private var host: NSHostingController<AnyView>?

    func show(_ row: TriageRow, controller: WorktreePanelController, onStart: @escaping (String) -> Void) {
        // `.id` resets the review's loaded diff when the same window is retargeted.
        let root = AnyView(WorktreeReviewSheet(row: row, controller: controller, onStart: onStart,
                                               onClose: { [weak self] in self?.close() }).id(row.id))
        let w = window ?? make()
        host?.rootView = root
        w.title = "Review \(row.tree)"
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func close() { window?.close() }

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
        window = w
        self.host = host
        return w
    }
}
