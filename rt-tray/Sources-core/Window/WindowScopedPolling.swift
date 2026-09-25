import Foundation

/// Polls only while its window is open. A window kept for reuse
/// (`isReleasedWhenClosed = false`) never removes its SwiftUI hosting view,
/// so `onDisappear` never fires on close: the window's own close
/// notification stops polling, and each `show()` starts it again.
@MainActor
public final class WindowScopedPolling {
    private let start: @MainActor () -> Void
    private let center: NotificationCenter
    private let observer: NSObjectProtocol

    public init(window: AnyObject, closing: Notification.Name, center: NotificationCenter = .default,
                start: @escaping @MainActor () -> Void, stop: @escaping @MainActor () -> Void) {
        self.start = start
        self.center = center
        observer = center.addObserver(forName: closing, object: window, queue: nil) { _ in
            MainActor.assumeIsolated { stop() }
        }
    }

    deinit { center.removeObserver(observer) }

    public func show() { start() }
}
