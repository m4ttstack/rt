#!/usr/bin/env swift
/**
 * make-icon.swift: the chat app icon, in mattstack's family.
 *
 * Same canvas, palette, corner radius, monospace "m" and stroke weight as
 * repo-tools' rt-tray/make-icon.swift, with a speech bubble where the
 * mattstack icon carries its layers glyph. Writes the raster set the web
 * app links from index.html; favicon.svg is the hand-drawn vector twin.
 *
 * Run from the repo root:  swift scripts/make-icon.swift
 */
import Foundation
import CoreGraphics
import AppKit

// Pink canvas, dark glyph, as console's mark is: the dark squircle receded
// at 16px in a tab strip. Source constants; they ship as #ff84ad / #1d1830.
let bg: (CGFloat, CGFloat, CGFloat) = (255 / 255, 107 / 255, 157 / 255)   // #FF6B9D
let fg: (CGFloat, CGFloat, CGFloat) = (22 / 255, 18 / 255, 36 / 255)     // #161224

struct Slot { let filename: String; let pixels: Int }
let slots: [Slot] = [
    Slot(filename: "public/favicon-16.png", pixels: 16),
    Slot(filename: "public/favicon-32.png", pixels: 32),
    Slot(filename: "public/apple-touch-icon.png", pixels: 180),
    Slot(filename: "public/icon-512.png", pixels: 512),
]

func makeFont(size: CGFloat) -> CTFont {
    for name in ["SF Mono", "Menlo", "Courier New"] {
        let f = CTFontCreateWithName(name as CFString, size, nil)
        let actual = CTFontCopyName(f, kCTFontPostScriptNameKey) as String? ?? ""
        if actual.lowercased().contains(name.lowercased().prefix(5)) { return f }
    }
    return CTFontCreateWithName("Menlo" as CFString, size, nil)
}

/// A speech bubble on the same 24-unit grid the layers glyph uses. Stroked
/// beside the "m" on the large sizes; filled solid on the favicon sizes,
/// where an outline is a thin ring nobody can read.
func drawBubbleGlyph(_ ctx: CGContext, in rect: CGRect, color: CGColor, filled: Bool = false) {
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        CGPoint(x: rect.minX + x / 24 * rect.width, y: rect.minY + (1 - y / 24) * rect.height)
    }
    // Stroked (large sizes): the lucide-style bubble with a nick of a tail.
    // Filled (favicon sizes): a rounder, shorter body and a wedge tail wide
    // enough to still be a tail at 16px, where the nick reads as a corner.
    let path = CGMutablePath()
    if filled {
        let r = rect.width * 4.5 / 24
        path.move(to: p(6.5, 2))
        path.addLine(to: p(17.5, 2))
        path.addArc(tangent1End: p(22, 2), tangent2End: p(22, 6.5), radius: r)
        path.addLine(to: p(22, 11.5))
        path.addArc(tangent1End: p(22, 16), tangent2End: p(17.5, 16), radius: r)
        path.addLine(to: p(13, 16))
        path.addLine(to: p(4.5, 22.5))
        path.addLine(to: p(6, 16))
        path.addArc(tangent1End: p(2, 16), tangent2End: p(2, 11.5), radius: r)
        path.addLine(to: p(2, 6.5))
        path.addArc(tangent1End: p(2, 2), tangent2End: p(6.5, 2), radius: r)
        path.closeSubpath()
    } else {
        let r = rect.width * 2.4 / 24
        path.move(to: p(4.4, 3))
        path.addLine(to: p(19.6, 3))
        path.addArc(tangent1End: p(22, 3), tangent2End: p(22, 5.4), radius: r)
        path.addLine(to: p(22, 14.6))
        path.addArc(tangent1End: p(22, 17), tangent2End: p(19.6, 17), radius: r)
        path.addLine(to: p(9.5, 17))
        path.addLine(to: p(5, 21.5))
        path.addLine(to: p(5, 17))
        path.addLine(to: p(4.4, 17))
        path.addArc(tangent1End: p(2, 17), tangent2End: p(2, 14.6), radius: r)
        path.addLine(to: p(2, 5.4))
        path.addArc(tangent1End: p(2, 3), tangent2End: p(4.4, 3), radius: r)
        path.closeSubpath()
    }
    ctx.saveGState()
    ctx.addPath(path)
    if filled {
        ctx.setFillColor(color)
        ctx.fillPath()
    } else {
        ctx.setStrokeColor(color)
        ctx.setLineWidth(max(1.0, rect.width * 2 / 24))
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        ctx.strokePath()
    }
    ctx.restoreGState()
}

func render(_ slot: Slot) {
    let px = slot.pixels
    guard let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        print("  x could not create a context for \(slot.filename)"); return
    }
    let size = CGFloat(px)
    let radius = size * 0.225
    ctx.setFillColor(CGColor(red: bg.0, green: bg.1, blue: bg.2, alpha: 1))
    ctx.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: size, height: size),
                       cornerWidth: radius, cornerHeight: radius, transform: nil))
    ctx.fillPath()

    let fgColor = CGColor(red: fg.0, green: fg.1, blue: fg.2, alpha: 1)

    // Favicon sizes: the bubble alone, large. At 16px the "m" plus bubble
    // pair reads as two smudges; one mark filling the canvas still reads.
    if px <= 64 {
        let side = size * 0.75
        // The tail hangs below the body, so the box is nudged down until the
        // body, the mass the eye centres, sits on the canvas centre.
        drawBubbleGlyph(ctx, in: CGRect(x: (size - side) / 2.0, y: (size - side) / 2.0 - size * 0.14,
                                        width: side, height: side), color: fgColor, filled: true)
        write(ctx, slot)
        return
    }

    let font = makeFont(size: size * 0.40) as NSFont
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor(calibratedRed: fg.0, green: fg.1, blue: fg.2, alpha: 1),
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: "m", attributes: attrs))
    var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
    let lineW = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
    let lineH = ascent + descent

    let glyphSide = size * 0.30
    let gap = size * 0.06
    let startX = (size - (lineW + gap + glyphSide)) / 2.0
    ctx.textPosition = CGPoint(x: startX, y: (size - lineH) / 2.0 + descent + size * 0.01)
    CTLineDraw(line, ctx)
    drawBubbleGlyph(ctx, in: CGRect(x: startX + lineW + gap, y: (size - glyphSide) / 2.0,
                                    width: glyphSide, height: glyphSide), color: fgColor)

    write(ctx, slot)
}

func write(_ ctx: CGContext, _ slot: Slot) {
    guard let image = ctx.makeImage() else { return }
    let rep = NSBitmapImageRep(cgImage: image)
    guard let data = rep.representation(using: .png, properties: [:]) else { return }
    do {
        try data.write(to: URL(fileURLWithPath: slot.filename))
        print("  wrote \(slot.filename) (\(slot.pixels)px)")
    } catch {
        print("  x \(slot.filename): \(error)")
    }
}

for slot in slots { render(slot) }
