#if DEBUG
import AppKit
import SwiftUI
import WebKit

/// One window, one webview, one find bar, and the real Edit ▸ Find menu:
/// `rt-tray --find-bar-preview [url]`.
///
/// It exists because the tray cannot be launched twice. A scratch build of
/// the app stands down against whichever flavor owns this machine, so there
/// is no way to put a second mattstack window on screen just to look at the
/// find bar. This mode boots none of that -- no tray socket, no daemon, no
/// flavor gate -- and still exercises the two things the self-check cannot:
/// ⌘F travelling from the menu down the responder chain, and how the bar
/// looks against the shell's own chrome.
///
/// The webview is mounted through NSHostingController the way the real
/// window mounts it, so the responder chain has the same shape.
enum FindBarPreview {
    private static var window: NSWindow!
    private static var container: FindBarContainer!

    static func run(url: String?) -> Never {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        installMenu()

        let webView = WKWebView(frame: .zero)
        container = FindBarContainer(webView: webView)

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 700),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "find bar preview"
        window.contentViewController = NSHostingController(rootView: PreviewContent())
        window.center()

        if let url, let parsed = URL(string: url) {
            webView.load(URLRequest(url: parsed))
        } else {
            webView.loadHTMLString(samplePage, baseURL: nil)
        }

        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        print("⌘F to find, ⌘G / ⇧⌘G to step, Escape to close the bar. ⌘Q to quit.")
        app.run()
        exit(0)
    }

    /// The same Edit ▸ Find submenu the tray installs, so the key equivalents
    /// and the responder-chain routing are the real ones.
    private static func installMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.addItem(.separator())
        edit.addItem(FindMenu.submenuItem())
        editItem.submenu = edit

        NSApp.mainMenu = main
    }

    private struct PreviewContent: View {
        var body: some View {
            Mount().ignoresSafeArea()
        }
    }

    private struct Mount: NSViewRepresentable {
        func makeNSView(context: Context) -> NSView { NSView() }

        func updateNSView(_ host: NSView, context: Context) {
            guard host.subviews.first !== container else { return }
            host.subviews.forEach { $0.removeFromSuperview() }
            container.frame = host.bounds
            container.autoresizingMask = [.width, .height]
            host.addSubview(container)
        }
    }

    private static let samplePage = """
    <html><body style="font:16px/1.6 -apple-system;padding:40px;max-width:44em">
    <h1>find bar preview</h1>
    <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod
    tempor incididunt ut labore et dolore magna aliqua.</p>
    <p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi
    ut aliquip ex ea commodo consequat. Lorem again, further down.</p>
    <p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
    dolore eu fugiat nulla pariatur.</p>
    <p>Excepteur sint occaecat cupidatat non proident, sunt in culpa qui
    officia deserunt mollit anim id est laborum. One last Lorem here.</p>
    </body></html>
    """
}
#endif
