import SwiftUI

/// Every animation knob in one place: a follow-up tweak-by-eye pass is a
/// one-line edit here, never a hunt through the view body.
enum SplashTuning {
    // Assembly order is bottom-up (like objects landing in a pile): the
    // bottom bar starts falling first and settles first, the top bar starts
    // last and lands last, completing the stack.
    static let bottomBarDelay: Double = 0
    static let middleBarDelay: Double = 0.06
    static let topBarDelay: Double = 0.12

    // Higher resting position -> greater start offset, so every bar falls
    // the same "distance per unit time" feel despite the staggered start.
    static let bottomBarStartOffset: CGFloat = -60
    static let middleBarStartOffset: CGFloat = -90
    static let topBarStartOffset: CGFloat = -120

    static let springResponse: Double = 0.3
    static let springDamping: Double = 0.75

    static let wordmarkFadeDelay: Double = 0.15
    static let wordmarkFadeDuration: Double = 0.25

    static let dismissFadeDuration: Double = 0.25
}

private let splashBackground = Color(red: 0x16 / 255.0, green: 0x16 / 255.0, blue: 0x1e / 255.0)
private let wordmarkColor = Color(red: 0xe3 / 255.0, green: 0xe7 / 255.0, blue: 0xf6 / 255.0)

// Prod bars: the pink family fixed by the design spec.
private let prodBarBase = Color(red: 0xff / 255.0, green: 0x8f / 255.0, blue: 0xb3 / 255.0)
private let prodBarDark = Color(red: 0xf7 / 255.0, green: 0x6e / 255.0, blue: 0x9e / 255.0)

// Dev bars: the dev app icon's own accent (make-icon.swift devPalette.fg,
// #FFB347), so a dev build is visually distinct at launch. make-icon.swift
// only defines one accent per flavor (no separate "darker middle" shade for
// dev), so the middle bar's darker tone is derived mechanically (12% darker)
// rather than an invented second hex.
private let devBarBase = Color(red: 0xff / 255.0, green: 0xb3 / 255.0, blue: 0x47 / 255.0)
private let devBarDark = Color(red: 0xff / 255.0 * 0.88, green: 0xb3 / 255.0 * 0.88, blue: 0x47 / 255.0 * 0.88)

private let barWidth: CGFloat = 26
private let barHeight: CGFloat = 6
private let barGap: CGFloat = 4

private struct SplashBar: Identifiable {
    let id: String
    let color: Color
    let startOffset: CGFloat
    let delay: Double
}

struct SplashView: View {
    @State private var play = false

    private var barBase: Color { BundleFlavor.isDevBuild ? devBarBase : prodBarBase }
    private var barDark: Color { BundleFlavor.isDevBuild ? devBarDark : prodBarDark }

    private var bars: [SplashBar] {
        [
            SplashBar(id: "top", color: barBase,
                      startOffset: SplashTuning.topBarStartOffset, delay: SplashTuning.topBarDelay),
            SplashBar(id: "middle", color: barDark,
                      startOffset: SplashTuning.middleBarStartOffset, delay: SplashTuning.middleBarDelay),
            SplashBar(id: "bottom", color: barBase,
                      startOffset: SplashTuning.bottomBarStartOffset, delay: SplashTuning.bottomBarDelay),
        ]
    }

    var body: some View {
        ZStack {
            splashBackground.ignoresSafeArea()
            HStack(spacing: 10) {
                VStack(spacing: barGap) {
                    ForEach(bars) { bar in barView(bar) }
                }
                Text("mattstack")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundColor(wordmarkColor)
                    .opacity(play ? 1 : 0)
                    .animation(.easeInOut(duration: SplashTuning.wordmarkFadeDuration)
                        .delay(SplashTuning.wordmarkFadeDelay), value: play)
            }
        }
        .onAppear { play = true }
    }

    private func barView(_ bar: SplashBar) -> some View {
        RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(bar.color)
            .frame(width: barWidth, height: barHeight)
            .offset(y: play ? 0 : bar.startOffset)
            .opacity(play ? 1 : 0)
            .animation(.spring(response: SplashTuning.springResponse, dampingFraction: SplashTuning.springDamping)
                .delay(bar.delay), value: play)
    }
}
