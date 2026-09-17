import AppKit
import WebKit

/// One app tab's web content plus its find bar.
///
/// The bar is a small panel floating in the top-right corner of the page, so
/// opening it neither reflows the page nor steals a strip of the window. One
/// container per app, alive as long as its webview, so each tab keeps its own
/// query and its own open/closed bar.
final class FindBarContainer: NSView {
    let webView: WKWebView

    private lazy var bar: FindBar = {
        let bar = FindBar()
        bar.delegate = self
        return bar
    }()
    private var isBarVisible = false
    /// Every search is two async hops (clear the selection, then find), so
    /// two keystrokes can interleave as clear, clear, find, find -- and the
    /// second find resumes from the first one's match instead of from the
    /// top, landing a match too far along. Only the newest search may act.
    private var searchGeneration = 0

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        addSubview(webView)
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    // MARK: Layout

    override func layout() {
        super.layout()
        webView.frame = bounds
        guard isBarVisible else { return }
        let size = bar.fittingSize
        bar.frame = NSRect(x: max(0, bounds.width - size.width - FindBar.margin),
                           y: max(0, bounds.height - size.height - FindBar.margin),
                           width: min(size.width, bounds.width),
                           height: size.height)
    }

    // MARK: Show and hide

    func showFindBar() {
        if !isBarVisible {
            isBarVisible = true
            addSubview(bar)
            needsLayout = true
        }
        bar.takeFocus(in: window)
    }

    func hideFindBar() {
        guard isBarVisible else { return }
        isBarVisible = false
        bar.removeFromSuperview()
        needsLayout = true
        clearHighlight()
        // The web content is what the person was reading; handing focus back
        // means their next keystroke scrolls the page, not a dismissed field.
        window?.makeFirstResponder(webView)
    }

    // MARK: Searching

    /// WebKit's own find engine. `WKFindResult` reports only whether anything
    /// matched, so the bar shows a no-results state rather than a running
    /// count -- no public API on WKWebView returns the number of matches.
    private func search(backwards: Bool, restarting: Bool) {
        searchGeneration += 1
        let generation = searchGeneration

        let query = bar.query
        guard !query.isEmpty else {
            bar.showStatus("")
            clearHighlight()
            return
        }

        let configuration = WKFindConfiguration()
        configuration.backwards = backwards
        configuration.caseSensitive = false
        configuration.wraps = true

        let run = { [weak self] in
            guard let self, generation == self.searchGeneration else { return }
            self.webView.find(query, configuration: configuration) { [weak self] result in
                guard let self, generation == self.searchGeneration else { return }
                self.bar.showStatus(result.matchFound ? "" : "No results")
            }
        }

        // A find always resumes from the current selection, so typing another
        // character would otherwise skip to the match after the one being
        // typed. Dropping the selection first restarts from the top.
        if restarting {
            webView.evaluateJavaScript("window.getSelection().removeAllRanges()") { [weak self] _, _ in
                guard let self, generation == self.searchGeneration else { return }
                run()
            }
        } else {
            run()
        }
    }

    private func clearHighlight() {
        webView.evaluateJavaScript("window.getSelection().removeAllRanges()")
    }

    // MARK: Menu routing

    /// ⌘F lands on whatever has focus inside the web content and walks up the
    /// responder chain. `NSResponder` declares this action but WKWebView does
    /// not answer to it (verified against its runtime method list), so this
    /// container is the first responder in the chain that can serve it. The
    /// tags are AppKit's standard find-action tags even though the search
    /// itself is ours, which keeps the menu items ordinary.
    override func performTextFinderAction(_ sender: Any?) {
        guard let tag = (sender as? NSValidatedUserInterfaceItem)?.tag,
              let action = NSTextFinder.Action(rawValue: tag) else { return }
        switch action {
        case .showFindInterface: showFindBar()
        case .hideFindInterface: hideFindBar()
        case .nextMatch: search(backwards: false, restarting: false)
        case .previousMatch: search(backwards: true, restarting: false)
        default: break
        }
    }

    /// What the bar is telling the person right now ("" when a search is
    /// finding matches). Read by the self-check.
    var findStatus: String { bar.statusText }

    func canPerform(_ action: NSTextFinder.Action) -> Bool {
        switch action {
        case .showFindInterface: return true
        case .hideFindInterface: return isBarVisible
        case .nextMatch, .previousMatch: return isBarVisible && !bar.query.isEmpty
        default: return false
        }
    }
}

extension FindBarContainer: NSUserInterfaceValidations {
    func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        guard item.action == #selector(performTextFinderAction(_:)) else { return true }
        guard let action = NSTextFinder.Action(rawValue: item.tag) else { return false }
        return canPerform(action)
    }
}

extension FindBarContainer: FindBarDelegate {
    func findBar(_ bar: FindBar, queryChangedTo query: String) {
        search(backwards: false, restarting: true)
    }

    func findBarWantsNextMatch(_ bar: FindBar) {
        search(backwards: false, restarting: false)
    }

    func findBarWantsPreviousMatch(_ bar: FindBar) {
        search(backwards: true, restarting: false)
    }

    func findBarWantsDismissal(_ bar: FindBar) {
        hideFindBar()
    }
}
