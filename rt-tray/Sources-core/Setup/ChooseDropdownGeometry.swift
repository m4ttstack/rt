import CoreGraphics
import Foundation

/// The choose sheet's dismiss-on-outside-tap catcher must never cover the
/// suggestion dropdown itself: relying on ZStack paint order alone (catcher
/// declared first, dropdown declared second, expecting the dropdown to win
/// hit-testing as the topmost view) was found not to hold in practice --
/// the dropdown's own buttons read as not hittable even once the sheet was
/// fully presented. Carving the catcher's hit area down to the space
/// outside the dropdown removes the ambiguity structurally instead of
/// depending on z-order.
public enum ChooseDropdownGeometry {
    /// Up to four non-overlapping rects covering `bounds` minus `hole`
    /// (top, bottom, left, right strips); degenerate ones are dropped.
    public static func rectsOutside(_ hole: CGRect, in bounds: CGRect) -> [CGRect] {
        [
            CGRect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: hole.minY - bounds.minY),
            CGRect(x: bounds.minX, y: hole.maxY, width: bounds.width, height: bounds.maxY - hole.maxY),
            CGRect(x: bounds.minX, y: hole.minY, width: hole.minX - bounds.minX, height: hole.height),
            CGRect(x: hole.maxX, y: hole.minY, width: bounds.maxX - hole.maxX, height: hole.height),
        ].filter { $0.width > 0 && $0.height > 0 }
    }
}
