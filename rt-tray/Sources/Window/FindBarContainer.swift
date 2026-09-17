import AppKit
import WebKit

/// One app tab's web content plus the find bar AppKit builds for it.
///
/// `NSScrollView` conforms to `NSTextFinderBarContainer` for free, which is
/// why a plain text view gets ⌘F with no code at all. A `WKWebView`'s scroll
/// view belongs to WebKit and is not reachable, so the shell supplies the
/// container itself: the bar is AppKit's own (match counter, Done button,
/// wrap and case options), and all this type owes it is a place to sit and a
/// re-tile when its height changes.
///
/// One container per app, alive as long as its webview, so each tab keeps its
/// own query and its own open/closed bar.
final class FindBarContainer: NSView {
    let webView: WKWebView
    let finder = NSTextFinder()

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        addSubview(webView)
        finder.client = webView
        finder.findBarContainer = self
        finder.isIncrementalSearchingEnabled = true
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    // MARK: NSTextFinderBarContainer

    /// Assigned by NSTextFinder, never by us. It arrives before the bar is
    /// first shown, so mounting is gated on `isFindBarVisible` here as well as
    /// in the setter below.
    var findBarView: NSView? {
        didSet {
            guard findBarView !== oldValue else { return }
            oldValue?.removeFromSuperview()
            if isFindBarVisible, let findBarView { addSubview(findBarView) }
            needsLayout = true
        }
    }

    var isFindBarVisible: Bool = false {
        didSet {
            guard isFindBarVisible != oldValue else { return }
            if isFindBarVisible {
                if let findBarView { addSubview(findBarView) }
            } else {
                findBarView?.removeFromSuperview()
            }
            needsLayout = true
        }
    }

    func findBarViewDidChangeHeight() { needsLayout = true }

    func contentView() -> NSView? { webView }

    // MARK: Layout

    /// The bar squeezes the web content rather than floating over it, which
    /// is what every other macOS find bar does and what keeps the last line
    /// of a page reachable while searching.
    override func layout() {
        super.layout()
        let barHeight = isFindBarVisible ? (findBarView?.frame.height ?? 0) : 0
        if isFindBarVisible, let findBarView {
            findBarView.frame = NSRect(x: 0, y: bounds.height - barHeight,
                                       width: bounds.width, height: barHeight)
        }
        webView.frame = NSRect(x: 0, y: 0, width: bounds.width,
                               height: max(0, bounds.height - barHeight))
    }

    // MARK: Menu routing

    /// ⌘F lands on whatever has focus inside the web content and walks up the
    /// responder chain. `NSResponder` declares this action but WKWebView does
    /// not answer to it (verified against its runtime method list), so this
    /// container is the first responder in the chain that can serve it.
    override func performTextFinderAction(_ sender: Any?) {
        guard let tag = (sender as? NSValidatedUserInterfaceItem)?.tag,
              let action = NSTextFinder.Action(rawValue: tag) else { return }
        finder.performAction(action)
    }
}

extension FindBarContainer: NSTextFinderBarContainer {}

extension FindBarContainer: NSUserInterfaceValidations {
    func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        guard item.action == #selector(performTextFinderAction(_:)) else { return true }
        guard let action = NSTextFinder.Action(rawValue: item.tag) else { return false }
        return finder.validateAction(action)
    }
}
