import AppKit

protocol FindBarDelegate: AnyObject {
    /// The query changed as the person types; the search restarts from the
    /// top of the page rather than advancing from the current match.
    func findBar(_ bar: FindBar, queryChangedTo query: String)
    func findBarWantsNextMatch(_ bar: FindBar)
    func findBarWantsPreviousMatch(_ bar: FindBar)
    func findBarWantsDismissal(_ bar: FindBar)
}

/// The shell's own find bar: a small floating panel in the top-right corner
/// of the web content, not a strip across the window.
///
/// AppKit builds a find bar of its own (`NSTextFinder`), but it can only
/// drive an `NSTextFinderClient`, and WKWebView's declared conformance does
/// not implement the members the finder needs -- verified end to end against
/// a live, key window: the bar mounts and stays inert, while `WKWebView.find`
/// on the same page selects matches fine. So the bar is ours and the search
/// engine is WebKit's.
final class FindBar: NSView {
    /// Gap from the top and trailing edges of the web content.
    static let margin: CGFloat = 12

    weak var delegate: FindBarDelegate?

    private let field = NSSearchField()
    private let status = NSTextField(labelWithString: "")
    private let previous = FindBar.iconButton("chevron.up", "Find Previous")
    private let next = FindBar.iconButton("chevron.down", "Find Next")
    private let close = FindBar.iconButton("xmark", "Close Find Bar")

    var query: String { field.stringValue }
    var statusText: String { status.isHidden ? "" : status.stringValue }

    init() {
        super.init(frame: .zero)
        // The shell's chrome is dark whatever the window it sits in, so the
        // search field and its focus ring render dark too.
        appearance = NSAppearance(named: .darkAqua)
        wantsLayer = true
        layer?.backgroundColor = ShellChrome.activeTab.nsColor.cgColor
        layer?.cornerRadius = 8
        layer?.cornerCurve = .continuous
        layer?.borderWidth = 1
        layer?.borderColor = ShellChrome.separator.nsColor.cgColor
        // Drawn over live web content, so it needs to read as floating above
        // the page rather than painted onto it.
        shadow = NSShadow()
        layer?.shadowColor = NSColor.black.cgColor
        layer?.shadowOpacity = 0.35
        layer?.shadowRadius = 10
        layer?.shadowOffset = CGSize(width: 0, height: -2)

        field.placeholderString = "Search"
        // Typing is handled by controlTextDidChange and Return by
        // doCommandBy. Leaving the cell's own action live would double up:
        // a search field sends its action *while* typing as well, which
        // stepped the search one match past the one being typed.
        field.sendsWholeSearchString = true
        field.delegate = self
        field.font = .systemFont(ofSize: 12)
        field.setAccessibilityIdentifier(AXID.findBarField)

        status.font = .systemFont(ofSize: 11)
        status.textColor = ShellChrome.warn.nsColor
        status.isHidden = true
        status.setAccessibilityIdentifier(AXID.findBarStatus)

        previous.target = self
        previous.action = #selector(previousClicked)
        previous.setAccessibilityIdentifier(AXID.findBarPrevious)
        next.target = self
        next.action = #selector(nextClicked)
        next.setAccessibilityIdentifier(AXID.findBarNext)
        close.target = self
        close.action = #selector(closeClicked)
        close.setAccessibilityIdentifier(AXID.findBarDone)

        let stack = NSStackView(views: [field, status, previous, next, close])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 4
        stack.setCustomSpacing(8, after: field)
        stack.edgeInsets = NSEdgeInsets(top: 7, left: 8, bottom: 7, right: 8)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            // A fixed field, so the panel keeps one width while typing and
            // only grows when the no-results label appears.
            field.widthAnchor.constraint(equalToConstant: 190),
        ])
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    private static func iconButton(_ symbol: String, _ label: String) -> NSButton {
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: label) ?? NSImage()
        let button = NSButton(image: image, target: nil, action: nil)
        button.isBordered = false
        button.bezelStyle = .smallSquare
        button.imageScaling = .scaleProportionallyDown
        button.contentTintColor = ShellChrome.inactiveLabel.nsColor
        button.toolTip = label
        button.widthAnchor.constraint(equalToConstant: 22).isActive = true
        button.heightAnchor.constraint(equalToConstant: 20).isActive = true
        return button
    }

    /// Opening the bar on an existing query selects it, so the next keystroke
    /// replaces the old search instead of appending to it.
    func takeFocus(in window: NSWindow?) {
        window?.makeFirstResponder(field)
        field.currentEditor()?.selectAll(nil)
    }

    func showStatus(_ text: String) {
        status.stringValue = text
        status.isHidden = text.isEmpty
        invalidateIntrinsicContentSize()
        superview?.needsLayout = true
    }

    @objc private func previousClicked() { delegate?.findBarWantsPreviousMatch(self) }
    @objc private func nextClicked() { delegate?.findBarWantsNextMatch(self) }
    @objc private func closeClicked() { delegate?.findBarWantsDismissal(self) }
}

extension FindBar: NSSearchFieldDelegate {
    func controlTextDidChange(_ obj: Notification) {
        delegate?.findBar(self, queryChangedTo: field.stringValue)
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        switch commandSelector {
        case #selector(NSResponder.cancelOperation(_:)):
            delegate?.findBarWantsDismissal(self)
            return true
        case #selector(NSResponder.insertNewline(_:)):
            delegate?.findBarWantsNextMatch(self)
            return true
        // Shift-Return in a field editor arrives as insertLineBreak:, and it
        // is the browser gesture for stepping backwards.
        case #selector(NSResponder.insertLineBreak(_:)):
            delegate?.findBarWantsPreviousMatch(self)
            return true
        default:
            return false
        }
    }
}
