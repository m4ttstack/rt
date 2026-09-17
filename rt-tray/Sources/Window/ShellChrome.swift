import AppKit
import SwiftUI

/// The window shell's chrome palette, spelled once. The tab bar renders in
/// SwiftUI and the find bar in AppKit, so every role is published in both
/// currencies from one set of components rather than as two drifting copies
/// of the same hex.
enum ShellChrome {
    struct Role {
        let r: Int, g: Int, b: Int

        var color: Color {
            Color(red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
        }
        var nsColor: NSColor {
            NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
        }
    }

    static let bar = Role(r: 0x0f, g: 0x0f, b: 0x15)
    static let separator = Role(r: 0x31, g: 0x38, b: 0x53)
    static let activeTab = Role(r: 0x1c, g: 0x21, b: 0x36)
    static let inactiveTab = Role(r: 0x16, g: 0x16, b: 0x1e)
    static let activeLabel = Role(r: 0xe3, g: 0xe7, b: 0xf6)
    static let inactiveLabel = Role(r: 0x7e, g: 0x86, b: 0xad)
    static let accent = Role(r: 0x7a, g: 0xa2, b: 0xf7)
    static let ok = Role(r: 0x3e, g: 0xb9, b: 0x53)
    static let warn = Role(r: 0xf7, g: 0x76, b: 0x8e)
}
