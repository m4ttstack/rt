import MattstackCore
import SwiftUI

private let railWidth: CGFloat = 68
private let railTopClearance: CGFloat = 40
private let tileSize: CGFloat = 38

struct MattstackWindowView: View {
    @ObservedObject var model: WindowModel

    var body: some View {
        HStack(spacing: 0) {
            RailView(model: model)
            ContentArea(model: model)
        }
        .background(
            Button("") { model.store.reload(model.activeApp) }
                .keyboardShortcut("r", modifiers: .command)
                .frame(width: 0, height: 0)
                .opacity(0)
        )
    }
}

private struct RailView: View {
    @ObservedObject var model: WindowModel

    var body: some View {
        VStack(spacing: 8) {
            Spacer().frame(height: railTopClearance)
            ForEach(Array(model.apps.prefix(9).enumerated()), id: \.element.name) { index, app in
                RailTile(model: model, app: app, shortcutIndex: index)
            }
            ForEach(model.apps.dropFirst(9), id: \.name) { app in
                RailTile(model: model, app: app, shortcutIndex: nil)
            }
            Spacer()
            RailTile(model: model, app: WindowModel.deckApp, shortcutIndex: nil, showsCatalogBadge: true)
                .padding(.bottom, 12)
        }
        .frame(width: railWidth)
        .frame(maxHeight: .infinity)
        .background(Color(red: 0.098, green: 0.102, blue: 0.122))
    }
}

private struct RailShortcut: ViewModifier {
    let index: Int?
    func body(content: Content) -> some View {
        if let index {
            content.keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
        } else {
            content
        }
    }
}

private struct RailTile: View {
    @ObservedObject var model: WindowModel
    let app: DiscoveryApp
    let shortcutIndex: Int?
    var showsCatalogBadge = false

    private var isActive: Bool { model.activeApp == app.name }

    var body: some View {
        Button {
            model.select(app.name)
        } label: {
            ZStack {
                tileImage
                    .frame(width: tileSize, height: tileSize)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .opacity(isActive ? 1.0 : 0.68)
                if isActive {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(Color.accentColor)
                        .frame(width: 3, height: tileSize)
                        .offset(x: -(railWidth - tileSize) / 2 - 2)
                }
                if showsCatalogBadge && model.catalogFresh {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 10, height: 10)
                        .offset(x: tileSize / 2 - 2, y: -(tileSize / 2 - 2))
                }
            }
        }
        .buttonStyle(.plain)
        .help(shortcutIndex != nil ? "\(app.displayName) \u{2318}\(shortcutIndex! + 1)" : app.displayName)
        .modifier(RailShortcut(index: shortcutIndex))
        .contextMenu {
            Button("Reload") { model.store.reload(app.name) }
        }
    }

    @ViewBuilder private var tileImage: some View {
        if let image = model.icons[app.name] {
            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .padding(6)
        } else {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color.gray.opacity(0.35))
                .overlay(
                    Text(String(app.displayName.prefix(1)))
                        .foregroundColor(.white)
                        .font(.system(size: 16, weight: .semibold))
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
