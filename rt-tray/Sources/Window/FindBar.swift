import AppKit

protocol FindBarDelegate: AnyObject {
    /// The query changed as the person types; the search restarts from the
    /// top of the page rather than advancing from the current match.
    func findBar(_ bar: FindBar, queryChangedTo query: String)
    func findBarWantsNextMatch(_ bar: FindBar)
    func findBarWantsPreviousMatch(_ bar: FindBar)
    func findBarWantsDismissal(_ bar: FindBar)
}

/// The shell's own find bar.
///
/// AppKit builds a perfectly good one (`NSTextFinder`), but it can only drive
/// an `NSTextFinderClient`, and WKWebView's declared conformance does not
/// implement the members NSTextFinder needs -- verified end to end against a
/// live, key window: the bar mounts and stays inert, while `WKWebView.find`
/// on the same page selects matches fine. So the bar is ours and the search
/// engine is WebKit's.
final class FindBar: NSView {
    static let height: CGFloat = 32

    weak var delegate: FindBarDelegate?

    private let field = NSSearchField()
    private let steppers = NSSegmentedControl(images: [
        NSImage(systemSymbolName: "chevron.up", accessibilityDescription: "Find Previous") ?? NSImage(),
        NSImage(systemSymbolName: "chevron.down", accessibilityDescription: "Find Next") ?? NSImage(),
    ], trackingMode: .momentary, target: nil, action: nil)
    private let status = NSTextField(labelWithString: "")
    private let done = NSButton(title: "Done", target: nil, action: nil)

    var query: String { field.stringValue }

    init() {
        super.init(frame: NSRect(x: 0, y: 0, width: 600, height: Self.height))
        wantsLayer = true
        layer?.backgroundColor = ShellChrome.bar.nsColor.cgColor

        field.placeholderString = "Find"
        // Typing is handled by controlTextDidChange and Return by
        // doCommandBy. Leaving the cell's own action live would double up:
        // a search field sends its action *while* typing as well, which
        // stepped the search one match past the one being typed.
        field.sendsWholeSearchString = true
        field.delegate = self
        field.setAccessibilityIdentifier(AXID.findBarField)

        steppers.target = self
        steppers.action = #selector(stepperClicked)
        steppers.setAccessibilityIdentifier(AXID.findBarSteppers)

        status.font = .systemFont(ofSize: 11)
        status.textColor = ShellChrome.inactiveLabel.nsColor
        status.setAccessibilityIdentifier(AXID.findBarStatus)

        done.bezelStyle = .rounded
        done.controlSize = .small
        done.target = self
        done.action = #selector(doneClicked)
        done.setAccessibilityIdentifier(AXID.findBarDone)

        let stack = NSStackView(views: [field, status, steppers, done])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 0, left: 10, bottom: 0, right: 10)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        // The field is the only view that grows; everything to its right keeps
        // its natural width so the Done button never drifts off the edge.
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        for view in [status, steppers, done] as [NSView] {
            view.setContentHuggingPriority(.required, for: .horizontal)
            view.setContentCompressionResistancePriority(.required, for: .horizontal)
        }

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        ShellChrome.separator.nsColor.setFill()
        NSRect(x: 0, y: 0, width: bounds.width, height: 1).fill()
    }

    /// Opening the bar on an existing query selects it, so the next keystroke
    /// replaces the old search instead of appending to it.
    func takeFocus(in window: NSWindow?) {
        window?.makeFirstResponder(field)
        field.currentEditor()?.selectAll(nil)
    }

    func showStatus(_ text: String) {
        status.stringValue = text
    }

    @objc private func stepperClicked() {
        if steppers.selectedSegment == 0 {
            delegate?.findBarWantsPreviousMatch(self)
        } else {
            delegate?.findBarWantsNextMatch(self)
        }
    }

    @objc private func doneClicked() {
        delegate?.findBarWantsDismissal(self)
    }
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
