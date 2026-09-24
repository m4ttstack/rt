import AppKit
import SwiftUI
import MattstackCore

/// `ImageRenderer` draws AppKit-backed controls (`Menu`, `ProgressView`,
/// `ScrollView`) as placeholders, so the offscreen snapshot swaps them for
/// plain SwiftUI stand-ins.
private struct TriageSnapshotKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    var triageSnapshot: Bool {
        get { self[TriageSnapshotKey.self] }
        set { self[TriageSnapshotKey.self] = newValue }
    }
}

enum TriagePalette {
    static func tint(_ tone: TriageTone) -> Color {
        switch tone {
        case .safe: return WT.green
        case .look: return WT.amber
        case .risk: return WT.red
        case .busy: return WT.accent
        case .held: return WT.textSecondary
        case .broken, .kept: return WT.textMuted
        }
    }
    static func well(_ tone: TriageTone) -> Color {
        switch tone {
        case .safe: return WT.greenFill
        case .look: return WT.amberFill
        case .risk: return WT.redFill
        case .busy: return WT.accentFill
        case .held, .broken, .kept: return WT.neutralFill
        }
    }
    static func icon(_ tone: TriageTone) -> String {
        switch tone {
        case .safe: return "checkmark.circle"
        case .look: return "doc.badge.ellipsis"
        case .risk: return "exclamationmark.triangle"
        case .held: return "lock"
        case .busy: return "rays"
        case .broken: return "arrow.triangle.2.circlepath"
        case .kept: return "bookmark"
        }
    }
    static func mrText(_ tone: MRTone) -> Color {
        switch tone { case .merged: return WT.accentText; case .closed: return WT.red; case .open: return WT.green }
    }
    static func mrFill(_ tone: MRTone) -> Color {
        switch tone { case .merged: return WT.accentFill; case .closed: return WT.redFill; case .open: return WT.greenFill }
    }
    static func mrIcon(_ tone: MRTone) -> String {
        switch tone { case .merged: return "arrow.triangle.merge"; case .closed: return "xmark.circle"; case .open: return "arrow.triangle.pull" }
    }
}

enum TriageLabels {
    static let buttonActions: Set<String> = ["dispose", "review", "push-branch", "unkeep", "stop-process", "open-herd", "open-run", "remove"]

    static func button(_ action: String) -> String {
        switch action {
        case "dispose": return "Dispose"
        case "review": return "Review"
        case "push-branch": return "Push branch"
        case "unkeep": return "Un-keep"
        case "stop-process": return "Stop process"
        case "open-herd": return "Open herd"
        case "open-run": return "Open run"
        case "remove": return "Remove"
        default: return action
        }
    }

    static func progressive(_ action: String) -> String {
        switch action {
        case "dispose": return "Disposing…"
        case "push-branch": return "Pushing…"
        case "keep": return "Keeping…"
        case "unkeep": return "Un-keeping…"
        case "stop-process": return "Stopping…"
        case "remove": return "Removing…"
        default: return "Working…"
        }
    }

    static func mrState(_ state: String) -> String { state == "opened" ? "open" : state }

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()
    private static let monthDay: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "MMM d"
        return f
    }()

    static func shortDate(_ iso: String?) -> String? {
        guard let iso, let date = isoFractional.date(from: iso) ?? isoPlain.date(from: iso) else { return nil }
        return monthDay.string(from: date)
    }

    static func push(_ push: TriageRow.Push) -> (text: String, icon: String) {
        switch push.kind {
        case "pushed": return ("pushed", "icloud.and.arrow.up")
        case "in-main": return ("in main", "arrow.triangle.branch")
        case "remote-deleted": return ("remote deleted", "icloud.slash")
        case "unpushed": return ("\(push.ahead ?? 0) unpushed", "arrow.clockwise.icloud")
        default: return (push.kind, "icloud")
        }
    }

    static func title(_ row: TriageRow) -> String { row.mr?.title ?? row.ticket?.title ?? row.branch ?? row.tree }
}

struct WorktreePanelView: View {
    @StateObject private var controller: WorktreePanelController
    @State private var reviewing: TriageRow?
    @State private var keptOpen: Bool
    /// The verb each busy row is running, so its button can say what it is doing.
    @State private var inFlight: [String: String] = [:]
    private let isSnapshot: Bool

    @MainActor init(controller: WorktreePanelController? = nil, keptOpen: Bool = false, isSnapshot: Bool = false) {
        _controller = StateObject(wrappedValue: controller ?? WorktreePanelController())
        _keptOpen = State(initialValue: keptOpen)
        self.isSnapshot = isSnapshot
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if isSnapshot {
                content
            } else {
                ScrollView { content }
            }
            footer
        }
        .frame(minWidth: 640, minHeight: isSnapshot ? 0 : 420)
        .background(WT.window)
        .environment(\.triageSnapshot, isSnapshot)
        .onAppear { controller.startPolling() }
        .onDisappear { controller.stopPolling() }
        .sheet(item: $reviewing) { row in
            WorktreeReviewSheet(row: row, controller: controller) { inFlight[row.id] = $0 }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(controller.banners, id: \.repo) { TriageBannerView(banner: $0) }
            ForEach(TriageSection.sections(controller.rows), id: \.0) { section, rows in
                if section == .kept {
                    keptDisclosure(rows)
                } else {
                    TriageSectionLabel(text: Self.title(section))
                    ForEach(rows) { row(for: $0) }
                }
            }
            if !controller.isLoading && controller.rows.isEmpty {
                Text("Nothing stuck. Every merged worktree was cleaned up.")
                    .foregroundStyle(WT.textSecondary).padding(24)
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 4)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(headline).font(.system(size: 21, weight: .semibold)).foregroundStyle(WT.text)
                Text("Their MR merged or closed, but something kept them from being cleaned up.")
                    .font(.system(size: 13.5)).foregroundStyle(WT.textSecondary)
            }
            Spacer(minLength: 0)
            bulkButton
        }
        .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 6)
    }

    @ViewBuilder private var bulkButton: some View {
        if let progress = controller.bulkProgress {
            TriageBulkButton(safe: progress.1, progress: progress) {}
        } else if let safe = controller.counts?.safe, safe > 0 {
            TriageBulkButton(safe: safe, progress: nil) {
                for row in controller.rows where row.group == "safe" { inFlight[row.id] = "dispose" }
                controller.cleanUpSafe()
            }
        }
    }

    private var headline: String {
        let n = controller.counts?.needsDecision ?? 0
        switch n {
        case 0: return "Nothing needs a decision"
        case 1: return "1 worktree needs a decision"
        default: return "\(n) worktrees need a decision"
        }
    }

    private var footer: some View {
        HStack(spacing: 6) {
            if let s = controller.status {
                Text(s.text).foregroundStyle(s.isError ? WT.red : WT.textSecondary)
            } else {
                Image(systemName: "trash").foregroundStyle(WT.textTertiary)
                Text("Disposed worktrees stay restorable for 14 days.").foregroundStyle(WT.textTertiary)
            }
            Spacer()
        }
        .font(.system(size: 12.5)).padding(.horizontal, 24).padding(.top, 10).padding(.bottom, 16)
    }

    @ViewBuilder private func keptDisclosure(_ rows: [TriageRow]) -> some View {
        Button {
            withAnimation(.easeOut(duration: 0.15)) { keptOpen.toggle() }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .rotationEffect(.degrees(keptOpen ? 90 : 0))
                    .foregroundStyle(WT.textTertiary)
                Text("KEPT (\(rows.count))")
                    .font(.system(size: 11.5, weight: .semibold)).tracking(0.6)
                    .foregroundStyle(WT.textTertiary)
                if !keptOpen {
                    Text(Self.keptSummary(rows)).font(.system(size: 13)).foregroundStyle(WT.textTertiary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.leading, 6).padding(.top, 14).padding(.bottom, keptOpen ? 4 : 0)
        if keptOpen {
            ForEach(rows) { row(for: $0) }
        }
    }

    private static func keptSummary(_ rows: [TriageRow]) -> String {
        let names = rows.prefix(3).map(\.tree).joined(separator: ", ") + (rows.count > 3 ? ", and \(rows.count - 3) more" : "")
        return rows.count == 1 ? "\(names). Comes back here if it changes." : "\(names). Each comes back here if it changes."
    }

    private static func title(_ s: TriageSection) -> String {
        switch s {
        case .needsDecision: return "NEEDS A DECISION"
        case .waiting: return "WAITING"
        case .broken: return "BROKEN"
        case .kept: return "KEPT"
        }
    }

    @ViewBuilder private func row(for r: TriageRow) -> some View {
        TriageRowView(row: r,
                      busy: controller.busy.contains(r.id),
                      busyAction: inFlight[r.id],
                      primaryDisabled: controller.bulkProgress != nil) { action in
            perform(action, on: r)
        }
    }

    private func perform(_ action: String, on r: TriageRow) {
        switch action {
        case "dispose": inFlight[r.id] = "dispose"; controller.dispose(r)
        case "dispose-anyway": inFlight[r.id] = "dispose"; controller.disposeAnyway(r)
        case "review": reviewing = r
        case "push-branch": inFlight[r.id] = "push-branch"; controller.pushBranch(r)
        case "keep": inFlight[r.id] = "keep"; controller.keep(r)
        case "unkeep": inFlight[r.id] = "unkeep"; controller.unkeep(r)
        case "stop-process": inFlight[r.id] = "stop-process"; controller.stopHolders(r)
        case "remove": inFlight[r.id] = "remove"; controller.remove(r)
        case "open-herd", "open-run":
            // The tray has no herd or run surface; the console is where both live.
            if let url = URL(string: "https://console.mattstack") { NSWorkspace.shared.open(url) }
        case "open-finder": NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: r.path)])
        case "open-terminal":
            NSWorkspace.shared.open([URL(fileURLWithPath: r.path)],
                                    withApplicationAt: URL(fileURLWithPath: "/System/Applications/Utilities/Terminal.app"),
                                    configuration: NSWorkspace.OpenConfiguration())
        case "copy-path":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(r.path, forType: .string)
        default: break
        }
    }
}

struct TriageSectionLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11.5, weight: .semibold)).tracking(0.6)
            .foregroundStyle(WT.textTertiary)
            .padding(.leading, 12).padding(.top, 14).padding(.bottom, 2)
    }
}

struct TriageBannerView: View {
    let banner: TriageBanner

    private var forgeName: String { banner.forge == "github" ? "GitHub" : "GitLab" }
    private var why: String {
        banner.reason == "no-token" ? "no \(forgeName) token." : "branch \(RepoIdentity.changeNoun(banner.repo)) checks are off for it."
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "powerplug").foregroundStyle(WT.amber)
            Text("Merged worktrees aren't cleaned up in \(banner.repoLabel): \(why)")
                .foregroundStyle(WT.amber)
            Spacer(minLength: 8)
            Button(banner.reason == "no-token" ? "Connect \(forgeName)" : "Open settings") {
                NotificationCenter.default.post(name: .rtShowSettings, object: nil)
            }
            .buttonStyle(TriageButtonStyle())
        }
        .font(.system(size: 13))
        .padding(.leading, 14).padding(.trailing, 10).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(WT.amberFill))
        .padding(.top, 8)
    }
}

struct TriageBulkButton: View {
    let safe: Int
    let progress: (Int, Int)?
    var forced: TriageInteraction? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: "sparkles")
                Text("Clean up \(safe) safe")
            }
        }
        .buttonStyle(TriageButtonStyle(primary: true,
                                       busyLabel: progress.map { "Cleaning up \($0.0 + 1) of \($0.1)…" },
                                       forced: forced, large: true))
        .disabled(progress != nil)
    }
}

// MARK: - Row

struct TriageRowView: View {
    let row: TriageRow
    var busy = false
    var busyAction: String? = nil
    var primaryDisabled = false
    var forceHover = false
    var onAction: (String) -> Void = { _ in }

    @Environment(\.triageSnapshot) private var isSnapshot
    @State private var hovering = false
    @State private var menuHover = false

    private var tone: TriageTone { TriageTone.tone(for: row) }
    private var kept: Bool { row.group == "kept" }
    private var lifted: Bool { forceHover || hovering }
    private var primary: String? {
        guard let first = row.actions.first, TriageLabels.buttonActions.contains(first) else { return nil }
        return first
    }

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            icon.opacity(busy ? 0.55 : 1)
            textColumn.opacity(busy ? 0.55 : 1)
            Spacer(minLength: 12)
            trailing
        }
        .padding(.leading, 14).padding(.trailing, 12).padding(.vertical, 13)
        .background(RoundedRectangle(cornerRadius: 10).fill(lifted ? WT.cardHover : WT.card))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(lifted ? WT.borderStrong : WT.border))
        .onHover { hovering = $0 }
    }

    private var icon: some View {
        let t: TriageTone = kept ? .kept : tone
        return ZStack {
            Circle().fill(TriagePalette.well(t))
            Image(systemName: TriagePalette.icon(tone))
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(TriagePalette.tint(t))
        }
        .frame(width: 30, height: 30)
    }

    private var textColumn: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(TriageLabels.title(row))
                .font(.system(size: 14.5, weight: .semibold))
                .foregroundStyle(row.group == "broken" ? WT.textBroken : WT.text)
                .lineLimit(1)
            HStack(spacing: 6) {
                Text(row.tree).font(.system(size: 13, weight: .medium))
                Text(row.branch.map { "\(row.repoLabel) · \($0)" } ?? row.repoLabel)
                    .font(.system(size: 12.5, design: .monospaced))
            }
            .foregroundStyle(WT.textSecondary)
            .lineLimit(1)
            if row.group != "broken" {
                chips
            }
            Text(row.verdict)
                .font(.system(size: 13))
                .foregroundStyle(kept ? WT.textMuted : WT.textSecondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var chips: some View {
        HStack(spacing: 6) {
            if let mr = row.mr {
                TriageMRChip(mr: mr, repo: row.repo, neutral: kept)
            } else {
                TriageChip(text: "no \(row.changeNoun)", icon: "circle.slash", muted: kept)
            }
            let push = TriageLabels.push(row.push)
            TriageChip(text: push.text, icon: push.icon,
                       iconTint: row.push.kind == "unpushed" && !kept ? WT.red : nil, muted: kept)
            if let ticket = row.ticket {
                TriageTicketChip(ticket: ticket, muted: kept)
            }
        }
    }

    @ViewBuilder private var trailing: some View {
        HStack(spacing: 8) {
            if busy {
                Button(TriageLabels.button(primary ?? "dispose")) {}
                    .buttonStyle(TriageButtonStyle(busyLabel: TriageLabels.progressive(busyAction ?? primary ?? "dispose")))
                    .disabled(true)
            } else if let primary {
                Button(TriageLabels.button(primary)) { onAction(primary) }
                    .buttonStyle(TriageButtonStyle(primary: primary == "push-branch"))
                    .disabled(primaryDisabled)
            } else if tone == .busy {
                Text("next pass").font(.system(size: 12.5)).foregroundStyle(WT.textTertiary)
            }
            moreMenu
                .disabled(busy || primaryDisabled)
                .opacity(busy ? 0.35 : 1)
        }
    }

    private var menuLabel: some View {
        Image(systemName: "ellipsis")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(WT.textSecondary)
            .frame(width: 26, height: 26)
            .background(RoundedRectangle(cornerRadius: 6).fill(menuHover || forceHover ? WT.controlHover : Color.clear))
            .contentShape(Rectangle())
    }

    private var menuKeep: Bool { row.actions.contains("keep") && primary != "keep" }
    private var menuUnkeep: Bool { row.actions.contains("unkeep") && primary != "unkeep" }
    private var menuDisposeAnyway: Bool { row.group == "only-copy" }

    @ViewBuilder private var moreMenu: some View {
        if isSnapshot {
            menuLabel
        } else {
            Menu {
                if menuKeep {
                    Button { onAction("keep") } label: { Label("Keep", systemImage: "bookmark") }
                }
                if menuUnkeep {
                    Button { onAction("unkeep") } label: { Label("Un-keep", systemImage: "bookmark.slash") }
                }
                if menuDisposeAnyway {
                    Button(role: .destructive) { onAction("dispose-anyway") } label: { Label("Dispose anyway", systemImage: "trash") }
                }
                if menuKeep || menuUnkeep || menuDisposeAnyway {
                    Divider()
                }
                if row.actions.contains("open-finder") {
                    Button { onAction("open-finder") } label: { Label("Open in Finder", systemImage: "folder") }
                }
                if row.actions.contains("open-terminal") {
                    Button { onAction("open-terminal") } label: { Label("Open in terminal", systemImage: "apple.terminal") }
                }
                if row.actions.contains("copy-path") {
                    Button { onAction("copy-path") } label: { Label("Copy path", systemImage: "doc.on.doc") }
                }
            } label: {
                menuLabel
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .onHover { menuHover = $0 }
            .accessibilityLabel("More")
        }
    }
}

// MARK: - Chips

struct TriageChip: View {
    let text: String
    var icon: String? = nil
    var iconTint: Color? = nil
    var muted = false
    var body: some View {
        let ink = muted ? WT.textMuted : WT.textSecondary
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 10.5)).foregroundStyle(iconTint ?? ink) }
            Text(text)
        }
        .font(.system(size: 12))
        .foregroundStyle(ink)
        .padding(.horizontal, 6).padding(.vertical, 1.5)
        .background(RoundedRectangle(cornerRadius: 4).fill(WT.neutralFill))
    }
}

/// Opens `url` on click and shows the arrow and pointing-hand cursor on
/// hover; a nil `url` is a plain, inert chip.
/// The cursor push is tracked so a chip that disappears under the pointer
/// (window closed, row dropped by a poll) still pops what it pushed.
private struct ChipLink: ViewModifier {
    let url: String?
    @Binding var hovering: Bool
    @State private var pushed = false
    func body(content: Content) -> some View {
        if let target = url.flatMap(URL.init(string:)) {
            content
                .contentShape(Rectangle())
                .onTapGesture { NSWorkspace.shared.open(target) }
                .onHover { inside in
                    hovering = inside
                    if inside, !pushed { NSCursor.pointingHand.push(); pushed = true }
                    if !inside, pushed { NSCursor.pop(); pushed = false }
                }
                .onDisappear {
                    if pushed { NSCursor.pop(); pushed = false }
                }
                .accessibilityAddTraits(.isLink)
        } else {
            content
        }
    }
}

struct TriageMRChip: View {
    let mr: TriageRow.MR
    let repo: String
    var neutral = false
    var forceHover = false
    @State private var hovering = false

    private var tone: MRTone { MRTone.of(mr.state) }
    private var ink: Color { neutral ? WT.textMuted : TriagePalette.mrText(tone) }
    private var fill: Color { neutral ? WT.neutralFill : TriagePalette.mrFill(tone) }
    private var hot: Bool { (forceHover || hovering) && mr.url != nil }
    private var text: String {
        let date = TriageLabels.shortDate(mr.at).map { " \($0)" } ?? ""
        return "\(RepoIdentity.changeMarker(repo))\(mr.iid) \(TriageLabels.mrState(mr.state))\(date)"
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: TriagePalette.mrIcon(tone)).font(.system(size: 10.5))
            Text(text)
            if hot { Image(systemName: "arrow.up.right").font(.system(size: 8.5, weight: .semibold)) }
        }
        .font(.system(size: 12))
        .foregroundStyle(ink)
        .padding(.horizontal, 6).padding(.vertical, 1.5)
        .background(RoundedRectangle(cornerRadius: 4).fill(fill))
        .modifier(ChipLink(url: mr.url, hovering: $hovering))
    }
}

struct TriageTicketChip: View {
    let ticket: TriageRow.Ticket
    var forceHover = false
    var muted = false
    @State private var hovering = false

    private var hot: Bool { (forceHover || hovering) && ticket.url != nil }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "ticket").font(.system(size: 10.5))
            Text(ticket.stateName.map { "\(ticket.identifier) · \($0)" } ?? ticket.identifier)
            if hot { Image(systemName: "arrow.up.right").font(.system(size: 8.5, weight: .semibold)) }
        }
        .font(.system(size: 12))
        .foregroundStyle(hot ? WT.text : muted ? WT.textMuted : WT.textSecondary)
        .padding(.horizontal, 6).padding(.vertical, 1.5)
        .background(RoundedRectangle(cornerRadius: 4).fill(hot ? WT.neutralFillHover : WT.neutralFill))
        .modifier(ChipLink(url: ticket.url, hovering: $hovering))
    }
}

// MARK: - Buttons

enum TriageInteraction { case rest, hover, pressed, disabled, busy }

/// Secondary (bordered) and primary (accent) buttons. `forced` pins a state
/// for the snapshot harness; live use leaves it nil and reads hover and press.
struct TriageButtonStyle: ButtonStyle {
    var primary = false
    var busyLabel: String? = nil
    var forced: TriageInteraction? = nil
    var large = false

    func makeBody(configuration: Configuration) -> some View {
        TriageButtonBody(configuration: configuration, primary: primary, busyLabel: busyLabel, forced: forced, large: large)
    }
}

private struct TriageButtonBody: View {
    let configuration: ButtonStyle.Configuration
    let primary: Bool
    let busyLabel: String?
    let forced: TriageInteraction?
    let large: Bool
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovering = false

    private var state: TriageInteraction {
        if let forced { return forced }
        if busyLabel != nil { return .busy }
        if !isEnabled { return .disabled }
        if configuration.isPressed { return .pressed }
        return hovering ? .hover : .rest
    }

    var body: some View {
        let s = state
        HStack(spacing: 6) {
            if s == .busy { TriageSpinner().frame(width: 11, height: 11) }
            if s == .busy, let busyLabel { Text(busyLabel) } else { configuration.label }
        }
        .font(.system(size: large ? 14 : 13, weight: .semibold))
        .lineLimit(1)
        .fixedSize()
        .padding(.horizontal, large ? 13 : 11).padding(.vertical, large ? 7 : 5.5)
        .foregroundStyle(ink(s))
        .background(RoundedRectangle(cornerRadius: 6).fill(fill(s)))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(border(s)))
        .opacity(primary && s == .disabled ? 0.45 : 1)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
    }

    private func ink(_ s: TriageInteraction) -> Color {
        if primary { return .white }
        switch s {
        case .busy: return WT.textSecondary
        case .disabled: return WT.textDisabled
        default: return WT.text
        }
    }

    private func fill(_ s: TriageInteraction) -> Color {
        if primary {
            switch s {
            case .hover: return WT.accentHover
            case .pressed: return WT.accentPressed
            default: return WT.accent
            }
        }
        switch s {
        case .hover: return WT.controlHover
        case .pressed: return WT.controlPressed
        case .disabled: return WT.controlDisabled
        default: return WT.card
        }
    }

    private func border(_ s: TriageInteraction) -> Color {
        if primary { return .clear }
        return s == .hover || s == .pressed ? WT.borderStrong : WT.border
    }
}

struct TriageSpinner: View {
    @Environment(\.triageSnapshot) private var isSnapshot
    @State private var spinning = false
    var body: some View {
        Circle()
            .trim(from: 0.08, to: 0.8)
            .stroke(style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
            .rotationEffect(.degrees(spinning ? 360 : 0))
            .onAppear {
                guard !isSnapshot else { return }
                withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { spinning = true }
            }
    }
}
