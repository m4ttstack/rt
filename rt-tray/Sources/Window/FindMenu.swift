import AppKit

/// The standard Edit ▸ Find submenu, nil-targeted so it walks the responder
/// chain to the showing tab's find bar container. The tags are the contract
/// AppKit reads to tell the three apart, so they are spelled from
/// `NSTextFinder.Action` rather than as literals.
enum FindMenu {
    static func submenuItem() -> NSMenuItem {
        let action = #selector(NSResponder.performTextFinderAction(_:))
        let item = NSMenuItem(title: "Find", action: nil, keyEquivalent: "")
        let menu = NSMenu(title: "Find")

        let show = menu.addItem(withTitle: "Find…", action: action, keyEquivalent: "f")
        show.tag = NSTextFinder.Action.showFindInterface.rawValue
        show.setAccessibilityIdentifier(AXID.menuEditFind)

        let next = menu.addItem(withTitle: "Find Next", action: action, keyEquivalent: "g")
        next.tag = NSTextFinder.Action.nextMatch.rawValue
        next.setAccessibilityIdentifier(AXID.menuEditFindNext)

        let previous = menu.addItem(withTitle: "Find Previous", action: action, keyEquivalent: "g")
        previous.keyEquivalentModifierMask = [.command, .shift]
        previous.tag = NSTextFinder.Action.previousMatch.rawValue
        previous.setAccessibilityIdentifier(AXID.menuEditFindPrevious)

        item.submenu = menu
        return item
    }
}
