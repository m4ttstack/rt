#if DEBUG
import AppKit
import WebKit

/// End-to-end check for the find bar, run as `rt-tray --find-bar-self-check`.
///
/// It lives in the app rather than in a test target because the bar is only
/// itself in a real, key window: the search field needs a field editor and
/// real keystrokes, and `WKWebView.find` needs a live web process. It has
/// already earned that: it caught a search field firing its own action while
/// typing (every burst landed a match too far) and a restart race.
///
/// Not part of any automated suite -- it takes over the screen for a few
/// seconds -- so run it by hand after touching FindBar or FindBarContainer:
///
///     swift build --product rt-tray
///     .build/debug/rt-tray --find-bar-self-check
enum FindBarSelfCheck {
    private static let page = """
    <html><body style="font:16px -apple-system;padding:24px">
    <h1>find bar self-check</h1>
    <p id="p1">Lorem ipsum dolor sit amet</p>
    <p id="p2">consectetur Lorem adipiscing elit</p>
    <p id="p3">sed do eiusmod tempor Lorem incididunt</p>
    </body></html>
    """

    /// The paragraph id plus the selected text, so stepping between matches
    /// is observable from outside the page.
    private static let selectionScript = """
    (function () {
      var s = window.getSelection();
      if (!s || s.rangeCount === 0 || s.toString() === '') return '';
      var n = s.anchorNode; while (n && !n.id) n = n.parentElement;
      return (n ? n.id : '?') + ':' + s.toString();
    })()
    """

    private static var results: [String] = []
    private static var webView: WKWebView!
    private static var container: FindBarContainer!
    private static var window: NSWindow!
    private static var delegate: LoadWatcher!

    static func run() -> Never {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 700, height: 460))
        container = FindBarContainer(webView: webView)
        container.frame = NSRect(x: 0, y: 0, width: 700, height: 460)
        container.autoresizingMask = [.width, .height]

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 460),
                          styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "find bar self-check (closes itself)"
        window.contentView?.addSubview(container)
        window.center()

        delegate = LoadWatcher()
        webView.navigationDelegate = delegate
        webView.loadHTMLString(page, baseURL: nil)

        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)

        after(30) {
            note("finished before the timeout", false)
            finish()
        }
        app.run()
        exit(0)
    }

    // MARK: The checks

    fileprivate static func start() {
        note("window is key", window.isKeyWindow)

        container.performTextFinderAction(item(.showFindInterface))
        container.layoutSubtreeIfNeeded()
        note("web content keeps the whole window", webView.frame == container.bounds,
             "web \(webView.frame) of \(container.bounds)")
        if let barFrame = mountedBarFrame() {
            note("bar floats in the top-right corner",
                 abs(barFrame.maxX - (container.bounds.width - FindBar.margin)) < 0.5
                     && abs(barFrame.maxY - (container.bounds.height - FindBar.margin)) < 0.5,
                 "\(barFrame) in \(container.bounds)")
            note("bar is a panel, not a strip", barFrame.width < container.bounds.width / 2,
                 "\(barFrame.width) wide")
        } else {
            note("bar is mounted", false)
        }
        note("find next stays disabled until there is a query", !container.canPerform(.nextMatch))

        type("Lorem")
        after(2.0) {
            // The query is reported because posted key events are the one
            // part of this check the run loop can drop or double: a later
            // step failing with a query of "Lorem" is a real defect, with
            // anything else it is the keystrokes that went wrong.
            note("typing reached the field as \"Lorem\"", container.findQuery == "Lorem",
                 "'\(container.findQuery)'")
            selection { first in
                note("typing selects the first match", first == "p1:Lorem", "'\(first)'")

                container.performTextFinderAction(item(.nextMatch))
                after(1.0) {
                    selection { second in
                        note("find next steps forward", second == "p2:Lorem", "'\(second)'")

                        container.performTextFinderAction(item(.previousMatch))
                        after(1.0) {
                            selection { back in
                                note("find previous steps back", back == "p1:Lorem",
                                     "'\(back)' status '\(container.findStatus)'")
                                closeAndFinish()
                            }
                        }
                    }
                }
            }
        }
    }

    private static func closeAndFinish() {
        container.performTextFinderAction(item(.hideFindInterface))
        container.layoutSubtreeIfNeeded()
        after(1.0) {
            selection { cleared in
                note("closing the bar clears the highlight", cleared.isEmpty, "'\(cleared)'")
                note("closing the bar unmounts it", mountedBarFrame() == nil)
                checkSearchInFlightWhenClosed()
            }
        }
    }

    /// A find handed to WebKit cannot be called back: it selects and scrolls
    /// whenever it finishes. The exposed case is the search a keystroke
    /// starts, which drops the page selection first and only issues the find
    /// once that returns -- so closing the bar in between leaves a highlight
    /// on a page with no find bar to clear it.
    ///
    /// The keystroke path is driven directly rather than by typing: a posted
    /// key event is delivered on a later turn, which would close the bar
    /// before the search ever started and prove nothing.
    private static func checkSearchInFlightWhenClosed() {
        container.performTextFinderAction(item(.showFindInterface))
        guard let bar = container.subviews.compactMap({ $0 as? FindBar }).first else {
            note("bar available for the in-flight case", false)
            finish()
        }
        container.findBar(bar, queryChangedTo: bar.query)
        container.performTextFinderAction(item(.hideFindInterface))
        after(1.5) {
            selection { leftover in
                note("a search in flight when the bar closes leaves no highlight",
                     leftover.isEmpty, "'\(leftover)'")
                finish()
            }
        }
    }

    private static func mountedBarFrame() -> NSRect? {
        container.subviews.first { $0 is FindBar }?.frame
    }

    // MARK: Plumbing

    private static func item(_ action: NSTextFinder.Action) -> NSMenuItem {
        let item = NSMenuItem(title: "", action: #selector(NSResponder.performTextFinderAction(_:)),
                              keyEquivalent: "")
        item.tag = action.rawValue
        return item
    }

    /// Real keystrokes through the field editor, because the double-stepping
    /// bug this check exists for only appears on the typing path.
    private static func type(_ text: String) {
        for character in text {
            guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
                                               timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: window.windowNumber, context: nil,
                                               characters: String(character),
                                               charactersIgnoringModifiers: String(character),
                                               isARepeat: false, keyCode: 0) else { continue }
            NSApp.postEvent(event, atStart: false)
        }
    }

    private static func selection(_ then: @escaping (String) -> Void) {
        webView.evaluateJavaScript(selectionScript) { value, _ in then(value as? String ?? "") }
    }

    private static func after(_ seconds: Double, _ work: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private static func note(_ label: String, _ ok: Bool, _ detail: String = "") {
        results.append("\(ok ? "PASS" : "FAIL") \(label)\(detail.isEmpty ? "" : " -> \(detail)")")
    }

    private static func finish() -> Never {
        for line in results { print(line) }
        window.orderOut(nil)
        exit(results.contains { $0.hasPrefix("FAIL") } ? 1 : 0)
    }

    private final class LoadWatcher: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            FindBarSelfCheck.start()
        }
    }
}
#endif
