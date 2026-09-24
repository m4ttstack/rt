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

private let barFill = ShellChrome.bar.color
private let separatorColor = ShellChrome.separator.color
private let activeFill = ShellChrome.activeTab.color
private let inactiveFill = ShellChrome.inactiveTab.color
private let activeLabelColor = ShellChrome.activeLabel.color
private let inactiveLabelColor = ShellChrome.inactiveLabel.color
private let tabAccentColor = ShellChrome.accent.color
private let okGreen = ShellChrome.ok.color
private let badgeFill = ShellChrome.badgeFill.color
private let badgeText = ShellChrome.badgeText.color

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

            // Opacity is driven explicitly from model.splashOpacity (animated
            // there via withAnimation), not a conditional `.transition`: the
            // view stays mounted for the fade's full duration and is only
            // removed (model flips splashVisible) once it's actually done,
            // so the fade is deterministic instead of racing a removal.
            if model.splashVisible {
                SplashView()
                    .opacity(model.splashOpacity)
                    .allowsHitTesting(model.splashOpacity > 0)
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .ignoresSafeArea()
    }
}

private struct TopTabBar: View {
    @ObservedObject var model: WindowModel

    var body: some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: trafficLightZoneWidth + barLeadingGap)
            // Only the tab run scrolls -- the traffic-light spacer and deck
            // mini stay pinned outside it -- so any number of apps degrades
            // to a scrollable strip instead of overflowing past the window
            // edge (rigid 110pt tabs past ~6 apps at the 900pt minimum width
            // pushed deck mini off the trailing edge with no clipping).
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    TabSeparator()
                    ForEach(Array(model.apps.prefix(9).enumerated()), id: \.element.name) { index, app in
                        TabButton(model: model, app: app, shortcutIndex: index)
                        TabSeparator()
                    }
                    ForEach(model.apps.dropFirst(9), id: \.name) { app in
                        TabButton(model: model, app: app, shortcutIndex: nil)
                        TabSeparator()
                    }
                }
                .frame(height: barHeight)
            }
            .frame(height: barHeight)
            Spacer(minLength: 0)
            NewBuildPill()
            DeckMini(model: model)
        }
        .frame(height: barHeight)
        .frame(maxWidth: .infinity)
        .background(barFill)
        .clipped()
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
    /// Read by both the reserved trailing space and the pill's own `if`, so
    /// the two can never disagree about whether a pill is showing or how
    /// wide its label is.
    private var pillLabel: String? {
        model.badges[app.name].flatMap { BadgeBook.label($0.count) }
    }
    /// Sized to `pillLabel`'s own width (1 digit, 2 digits, or "99+"), not a
    /// fixed reserve -- a flat 40pt reserve truncates the tab label on a
    /// 110pt tab when the pill is only 1 character wide.
    private var pillReserve: CGFloat {
        switch pillLabel?.count {
        case nil: return 0
        case 1: return 28
        case 2: return 34
        default: return 40
        }
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            // Size, fill, and hit shape live on the label, inside the Button,
            // not chained after it: chained after, the Button's own hit region
            // is only its content's natural size (label text/icon), leaving the
            // rest of the 110pt cell unclickable.
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
                    .padding(.trailing, pillReserve)
                    .frame(width: tabWidth, height: barHeight, alignment: .leading)

                    if isActive {
                        Rectangle().fill(tabAccentColor).frame(width: tabWidth, height: 2)
                    }
                }
                .frame(width: tabWidth, height: barHeight)
                .background(isActive ? activeFill : inactiveFill)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(shortcutIndex != nil ? "\(app.displayName) \u{2318}\(shortcutIndex! + 1)" : app.displayName)
            .modifier(TabShortcut(index: shortcutIndex))
            .contextMenu {
                Button("Reload") { model.store.reload(app.name) }
            }

            // A Button's label is one hit target on macOS, so the pill is a
            // sibling Button, not nested inside the tab's own label.
            if let label = pillLabel {
                Button { model.openBadge(for: app.name) } label: {
                    Text(label)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(badgeText)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(Capsule().fill(badgeFill))
                        .fixedSize()
                }
                .buttonStyle(.plain)
                .padding(.trailing, 8)
                .help("Open the oldest waiting decision")
            }
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

/// Dev flavor only: shown while a staged build differs from the running one.
private struct NewBuildPill: View {
    @ObservedObject private var state = TrayState.shared

    var body: some View {
        if let stamp = state.stagedBuildStamp, state.devRebuild != .building {
            Button {
                NotificationCenter.default.post(name: .rtDevRestartIntoStaged, object: nil)
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 10, weight: .semibold))
                    Text("New build · Restart")
                        .font(.system(size: 11, weight: .semibold))
                }
                .foregroundColor(badgeText)
                .padding(.horizontal, 8)
                .frame(height: 20)
                .background(Capsule().fill(tabAccentColor))
                .fixedSize()
            }
            .buttonStyle(.plain)
            .padding(.trailing, 10)
            .help("Quit and reopen mattstack-dev on the staged build (\(stamp))")
            .accessibilityIdentifier(AXID.windowDevRestart)
        }
    }
}

private struct DeckMini: View {
    @ObservedObject var model: WindowModel

    var body: some View {
        // Size and hit shape live on the label, inside the Button, not
        // chained after it, for the same reason as TabButton: chained
        // after, only the label's own content is clickable, not the full
        // cell. DeckMini has no separate fill to move (it always showed the
        // bar's own background through), so only frame + contentShape move.
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
            .padding(.horizontal, 16)
            .frame(height: barHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
                } else if model.loadingApps.contains(app.name) {
                    LoadingOverlay()
                }
            } else {
                // Before the catalog resolves there is no app to mount, and
                // the splash may already have gone, so this is what the
                // window shows in the meantime.
                LoadingOverlay()
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

    /// The mounted child is the app's find bar container, not its webview
    /// directly: the container owns the webview for the window's lifetime and
    /// puts a responder between the web content and the window that can serve
    /// ⌘F.
    func updateNSView(_ host: NSView, context: Context) {
        let container = model.findContainer(for: app)
        guard host.subviews.first !== container else { return }
        host.subviews.forEach { $0.removeFromSuperview() }
        container.frame = host.bounds
        container.autoresizingMask = [.width, .height]
        host.addSubview(container)
    }
}

/// Opaque, not a floating spinner over a half-drawn page: until the page has
/// something to show, the shell's own background is the better thing to look
/// at, and it is the same color the webview shows through.
private struct LoadingOverlay: View {
    var body: some View {
        ZStack {
            barFill
            ProgressView()
                .progressViewStyle(.circular)
                .controlSize(.small)
                .colorScheme(.dark)
        }
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
