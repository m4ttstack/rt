import SwiftUI

/// Every animation knob in one place: a follow-up tweak-by-eye pass is a
/// one-line edit here, never a hunt through the view body.
enum SplashTuning {
    // Assembly order is bottom-up (like objects landing in a pile): the
    // bottom layer starts falling first and settles first, the top layer
    // (the diamond) starts last and lands last, completing the stack.
    static let bottomLayerDelay: Double = 0
    static let middleLayerDelay: Double = 0.12
    static let topLayerDelay: Double = 0.24

    // Higher resting position -> greater start offset, so every layer falls
    // the same "distance per unit time" feel despite the staggered start.
    static let bottomLayerStartOffset: CGFloat = -60
    static let middleLayerStartOffset: CGFloat = -90
    static let topLayerStartOffset: CGFloat = -120

    // response ~0.45 / damping ~0.72 with the delays above settles the last
    // (top) layer around 1s: tight enough for "no lazy float" but no longer
    // the snappier <500ms feel of an earlier pass.
    static let springResponse: Double = 0.45
    static let springDamping: Double = 0.72

    static let dismissFadeDuration: Double = 0.25

    // The minimum-display gate WindowModel waits on before it will consider
    // dismissing the splash (the other half of the "later of" rule is the
    // active app's first navigation finishing, still uncapped here at 8s).
    // animationSettleDuration is a best-visual-estimate of when the drop-in
    // finishes, not something derived from the spring math -- if a future
    // eye-check says the animation actually settles earlier or later, this
    // is the one number to move.
    static let animationSettleDuration: Double = 1.0
    static let postSettleHold: Double = 1.0
    static var minimumVisibleDuration: Double { animationSettleDuration + postSettleHold }
}

private let splashBackground = Color(red: 0x16 / 255.0, green: 0x16 / 255.0, blue: 0x1e / 255.0)

// make-icon.swift's own per-flavor accent (prodPalette.fg / devPalette.fg):
// one color per flavor, used for both the "m" and the layers glyph there,
// so the splash mark matches the real app icon exactly rather than an
// approximation.
private let prodMarkColor = Color(red: 0xff / 255.0, green: 0x6b / 255.0, blue: 0x9d / 255.0)
private let devMarkColor = Color(red: 0xff / 255.0, green: 0xb3 / 255.0, blue: 0x47 / 255.0)

// Proportions lifted from make-icon.swift's renderSlot (fontSize = size *
// 0.40, glyphSide = size * 0.30, gap = size * 0.06 -> same 0.40:0.30:0.06
// ratio here, scaled up for a hero-sized splash mark instead of a favicon).
private let markFontSize: CGFloat = 56
private let glyphSide: CGFloat = 42
private let markGap: CGFloat = 8
private let glyphStrokeWidth: CGFloat = glyphSide * 2 / 24

/// The Lucide "layers" glyph make-icon.swift strokes beside the "m": a
/// closed diamond (the top layer) over two open chevrons (the layers
/// beneath it peeking out), all in the same 24x24 box, round caps/joins.
/// Point coordinates copied verbatim from `drawLayersGlyph` in
/// make-icon.swift; SwiftUI's Path is already y-down like the source SVG,
/// so (unlike that CoreGraphics version) no y-flip is needed here.
private enum LayersGlyph {
    static let diamond: [(CGFloat, CGFloat)] = [(12, 2.5), (21.8, 7.0), (12, 11.5), (2.2, 7.0)]
    static let midChevron: [(CGFloat, CGFloat)] = [(2.2, 12.3), (12, 16.8), (21.8, 12.3)]
    static let bottomChevron: [(CGFloat, CGFloat)] = [(2.2, 17.3), (12, 21.8), (21.8, 17.3)]
}

private struct GlyphPolyline: Shape {
    let points: [(CGFloat, CGFloat)]
    let closed: Bool

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let mapped = points.map { CGPoint(x: $0.0 / 24 * rect.width, y: $0.1 / 24 * rect.height) }
        guard let first = mapped.first else { return path }
        path.move(to: first)
        for point in mapped.dropFirst() { path.addLine(to: point) }
        if closed { path.closeSubpath() }
        return path
    }
}

struct SplashView: View {
    @State private var play = false

    private var markColor: Color { BundleFlavor.isDevBuild ? devMarkColor : prodMarkColor }
    private var strokeStyle: StrokeStyle { StrokeStyle(lineWidth: glyphStrokeWidth, lineCap: .round, lineJoin: .round) }

    var body: some View {
        ZStack {
            splashBackground.ignoresSafeArea()
            // Just the mark (m + layers glyph), centered -- no wordmark.
            HStack(spacing: markGap) {
                // make-icon.swift draws "m" in a monospace font (SF
                // Mono / Menlo fallback), not the system UI font.
                Text("m")
                    .font(.system(size: markFontSize, weight: .regular, design: .monospaced))
                    .foregroundColor(markColor)
                layersGlyph
            }
        }
        .onAppear { play = true }
    }

    /// The glyph's own "m"-then-stack order and right-of-m placement mirror
    /// make-icon.swift exactly (it draws "m" at startX, then the layers
    /// glyph at startX + lineWidth + gap -- to the right).
    private var layersGlyph: some View {
        ZStack {
            layer(GlyphPolyline(points: LayersGlyph.bottomChevron, closed: false),
                  delay: SplashTuning.bottomLayerDelay, startOffset: SplashTuning.bottomLayerStartOffset)
            layer(GlyphPolyline(points: LayersGlyph.midChevron, closed: false),
                  delay: SplashTuning.middleLayerDelay, startOffset: SplashTuning.middleLayerStartOffset)
            layer(GlyphPolyline(points: LayersGlyph.diamond, closed: true),
                  delay: SplashTuning.topLayerDelay, startOffset: SplashTuning.topLayerStartOffset)
        }
        .frame(width: glyphSide, height: glyphSide)
    }

    private func layer(_ shape: GlyphPolyline, delay: Double, startOffset: CGFloat) -> some View {
        shape
            .stroke(markColor, style: strokeStyle)
            .frame(width: glyphSide, height: glyphSide)
            .offset(y: play ? 0 : startOffset)
            .opacity(play ? 1 : 0)
            .animation(.spring(response: SplashTuning.springResponse, dampingFraction: SplashTuning.springDamping)
                .delay(delay), value: play)
    }
}
