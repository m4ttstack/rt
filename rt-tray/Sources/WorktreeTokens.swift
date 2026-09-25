import AppKit
import SwiftUI

/// Worktrees panel colours, sampled from `docs/design/worktrees/*-{light,dark}.png`.
/// Each resolves against the drawing appearance, so the live window and the
/// offscreen snapshot pick the same side.
enum WT {
    private static func ns(_ light: UInt32, _ dark: UInt32) -> NSColor {
        NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            let v = isDark ? dark : light
            return NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                           blue: CGFloat(v & 0xff) / 255, alpha: 1)
        }
    }
    private static func c(_ light: UInt32, _ dark: UInt32) -> Color { Color(nsColor: ns(light, dark)) }

    static let windowNS = ns(0xf6f6f4, 0x1c1c1e)
    static let window = Color(nsColor: windowNS)
    static let cardNS = ns(0xffffff, 0x252528)
    static let card = Color(nsColor: cardNS)
    static let cardHover = c(0xf7f7f5, 0x2c2c30)
    static let border = c(0xe2e2de, 0x34343a)
    static let borderStrong = c(0xcfcfca, 0x45454c)

    static let text = c(0x1b1b1d, 0xededef)
    static let textSecondary = c(0x5e5e66, 0xa1a1aa)
    static let textTertiary = c(0x8e8e96, 0x6e6e78)
    static let textMuted = c(0x9d9da4, 0x62626b)
    static let textBroken = c(0x75757b, 0x8d8d95)
    static let textDisabled = c(0x939393, 0x7a7a7c)

    static let neutralFill = c(0xefefec, 0x18181a)
    static let neutralFillHover = c(0xe3e3df, 0x34343a)
    static let controlHover = c(0xf2f2ef, 0x303035)
    static let controlPressed = c(0xe3e3df, 0x39393f)
    static let controlDisabled = c(0xfafaf9, 0x202023)

    static let accent = c(0x2f6feb, 0x5b8def)
    static let accentHover = c(0x255fd6, 0x6e9bf2)
    static let accentPressed = c(0x1e4eb6, 0x497add)
    static let accentFill = c(0xe7eefd, 0x1d2a45)
    static let accentText = c(0x2f6feb, 0x6e9bf2)

    static let green = c(0x1f8a4c, 0x4cc47f)
    static let greenFill = c(0xe6f4ec, 0x1e3327)
    static let red = c(0xc23a2b, 0xf07166)
    static let redFill = c(0xfbe7e4, 0x3d1f1c)
    static let amber = c(0xa5620a, 0xe7a948)
    static let amberFill = c(0xfbf0dd, 0x3a2c16)
}
