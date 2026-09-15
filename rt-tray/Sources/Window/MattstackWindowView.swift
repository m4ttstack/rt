import MattstackCore
import SwiftUI

private let barHeight: CGFloat = 34
private let tabWidth: CGFloat = 110
private let tabIconSize: CGFloat = 18
private let deckIconSize: CGFloat = 18
/// Not spec'd numerically: macOS lays out the traffic lights itself at
/// their native position once titlebarAppearsTransparent is set, so this is
/// just enough leading clearance for a hidden-title window's button cluster
/// before the spec's explicit 12pt gap.
private let trafficLightZoneWidth: CGFloat = 70
private let barLeadingGap: CGFloat = 12

private let barFill = Color(red: 0x0f / 255.0, green: 0x0f / 255.0, blue: 0x15 / 255.0)
private let separatorColor = Color(red: 0x31 / 255.0, green: 0x38 / 255.0, blue: 0x53 / 255.0)
private let activeFill = Color(red: 0x1c / 255.0, green: 0x21 / 255.0, blue: 0x36 / 255.0)
private let inactiveFill = Color(red: 0x16 / 255.0, green: 0x16 / 255.0, blue: 0x1e / 255.0)
private let activeLabelColor = Color(red: 0xe3 / 255.0, green: 0xe7 / 255.0, blue: 0xf6 / 255.0)
private let inactiveLabelColor = Color(red: 0x7e / 255.0, green: 0x86 / 255.0, blue: 0xad / 255.0)
private let tabAccentColor = Color(red: 0x7a / 255.0, green: 0xa2 / 255.0, blue: 0xf7 / 255.0)
private let okGreen = Color(red: 0x3e / 255.0, green: 0xb9 / 255.0, blue: 0x53 / 255.0)

struct MattstackWindowView: View {
    @ObservedObject var model: WindowModel

    var body: some View {
        ZStack {
            // Tab bar and content mount and render here regardless of the
            // splash: dismissal only fades the splash layer above, so the
            // live app is already the thing being revealed, never remounted.
            VStack(spacing: 0) {
                TopTabBar(model: model)
                Rectangle().fill(separatorColor).frame(height: 1)
                ContentArea(model: model)
            }
            .background(
                Button("") { model.store.reload(model.activeApp) }
                    .keyboardShortcut("r", modifiers: .command)
                    .frame(width: 0, height: 0)
                    .opacity(0)
            )

            if model.splashVisible {
                SplashView().transition(.opacity)
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .ignoresSafeArea()
        .animation(.easeOut(duration: SplashTuning.dismissFadeDuration), value: model.splashVisible)
    }
}

private struct TopTabBar: View {
    @ObservedObject var model: WindowModel

    var body: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: trafficLightZoneWidth + barLeadingGap)
            TabSeparator()
            ForEach(Array(model.apps.prefix(9).enumerated()), id: \.element.name) { index, app in
                TabButton(model: model, app: app, shortcutIndex: index)
                TabSeparator()
            }
            ForEach(model.apps.dropFirst(9), id: \.name) { app in
                TabButton(model: model, app: app, shortcutIndex: nil)
                TabSeparator()
            }
            Spacer(minLength: 0)
            DeckMini(model: model)
        }
        .frame(height: barHeight)
        .frame(maxWidth: .infinity)
        .background(barFill)
    }
}

private struct TabSeparator: View {
    var body: some View {
        Rectangle().fill(separatorColor).frame(width: 1).frame(maxHeight: .infinity)
    }
}

private struct TabShortcut: ViewModifier {
    let index: Int?
    func body(content: Content) -> some View {
        if let index {
            content.keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
        } else {
            content
        }
    }
}

private struct TabButton: View {
    @ObservedObject var model: WindowModel
    let app: DiscoveryApp
    let shortcutIndex: Int?

    private var isActive: Bool { model.activeApp == app.name }

    var body: some View {
        Button {
            model.select(app.name)
        } label: {
            ZStack(alignment: .bottom) {
                HStack(spacing: 6) {
                    tabIcon
                        .frame(width: tabIconSize, height: tabIconSize)
                        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                        .saturation(isActive ? 1 : 0)
                        .opacity(isActive ? 1 : 0.75)
                    Text(app.displayName.lowercased())
                        .font(.system(size: 12))
                        .foregroundColor(isActive ? activeLabelColor : inactiveLabelColor)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.leading, 10)
                .frame(width: tabWidth, height: barHeight, alignment: .leading)

                if isActive {
                    Rectangle().fill(tabAccentColor).frame(width: tabWidth, height: 2)
                }
            }
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .frame(width: tabWidth, height: barHeight)
        .background(isActive ? activeFill : inactiveFill)
        .help(shortcutIndex != nil ? "\(app.displayName) \u{2318}\(shortcutIndex! + 1)" : app.displayName)
        .modifier(TabShortcut(index: shortcutIndex))
        .contextMenu {
            Button("Reload") { model.store.reload(app.name) }
        }
    }

    @ViewBuilder private var tabIcon: some View {
        if let image = model.icons[app.name] {
            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
        } else {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(Color.gray.opacity(0.35))
                .overlay(
                    Text(String(app.displayName.prefix(1)))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.white)
                )
        }
    }
}

private struct DeckMini: View {
    @ObservedObject var model: WindowModel

    var body: some View {
        Button {
            model.select(WindowModel.deckApp.name)
        } label: {
            HStack(spacing: 6) {
                Text("deck")
                    .font(.system(size: 12))
                    .foregroundColor(inactiveLabelColor)
                ZStack(alignment: .topTrailing) {
                    deckIcon
                        .frame(width: deckIconSize, height: deckIconSize)
                        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                    if model.catalogFresh {
                        Circle()
                            .fill(okGreen)
                            .overlay(Circle().stroke(barFill, lineWidth: 2))
                            .frame(width: 7, height: 7)
                            .offset(x: 4, y: -4)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .padding(.horizontal, 16)
        .frame(height: barHeight)
        .help("Deck")
        .contextMenu {
            Button("Reload") { model.store.reload(WindowModel.deckApp.name) }
        }
    }

    @ViewBuilder private var deckIcon: some View {
        if let image = model.icons[WindowModel.deckApp.name] {
            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
        } else {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(Color.gray.opacity(0.35))
                .overlay(
                    Text("d")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.white)
                )
        }
    }
}

private struct ContentArea: View {
    @ObservedObject var model: WindowModel

    var body: some View {
        ZStack {
            if let app = model.app(named: model.activeApp) {
                WindowWebView(model: model, app: app)
                if model.loadFailures[app.name] == true {
                    FailureOverlay(model: model, app: app)
                }
            } else {
                Color(NSColor.windowBackgroundColor)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A plain container, not the webview itself: `activeApp` changing only
/// updates this representable's `app` property in place (same structural
/// SwiftUI identity), so `updateNSView` is what has to swap the mounted
/// child, never `makeNSView`.
private struct WindowWebView: NSViewRepresentable {
    let model: WindowModel
    let app: DiscoveryApp

    func makeNSView(context: Context) -> NSView {
        NSView()
    }

    func updateNSView(_ container: NSView, context: Context) {
        let webView = model.webView(for: app)
        guard container.subviews.first !== webView else { return }
        container.subviews.forEach { $0.removeFromSuperview() }
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
    }
}

private struct FailureOverlay: View {
    @ObservedObject var model: WindowModel
    let app: DiscoveryApp

    var body: some View {
        VStack(spacing: 12) {
            Text("Can't reach \(app.displayName)")
                .font(.headline)
            Button("Retry") {
                model.store.reload(app.name)
                model.loadFailures[app.name] = nil
            }
        }
        .padding(24)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
