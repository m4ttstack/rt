import AppKit
import SwiftUI
import MattstackCore

/// `rt-tray --render-worktree-snapshots <fixtures-dir> <out-dir>` renders the
/// Worktrees panel, the Review sheet and the interaction states from fixture
/// JSON, light and dark, then returns true so the caller exits before any
/// window, status item, socket or daemon work exists. DEBUG builds only.
enum WorktreeSnapshot {
    @MainActor
    static func runIfRequested() -> Bool {
        #if DEBUG
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--render-worktree-snapshots") else { return false }
        guard args.count > i + 2 else {
            FileHandle.standardError.write(Data("usage: --render-worktree-snapshots <fixtures-dir> <out-dir>\n".utf8))
            return true
        }
        let fixtures = URL(fileURLWithPath: args[i + 1]), out = URL(fileURLWithPath: args[i + 2])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        func load(_ name: String) -> TriageData {
            let data = try! Data(contentsOf: fixtures.appendingPathComponent(name))
            return try! JSONDecoder().decode(TriagePayload.self, from: data).data!
        }
        let diff = try! JSONDecoder().decode([TriageDiffFile].self,
                                             from: Data(contentsOf: fixtures.appendingPathComponent("worktree-triage-diff.json")))
        let panel = load("worktree-triage-panel.json"), catalog = load("worktree-triage-catalog.json")
        let look = catalog.rows.first { $0.group == "look" }!
        let voldemort = panel.rows.first { $0.tree == "voldemort" }!
        for scheme in [ColorScheme.light, .dark] {
            let tag = scheme == .light ? "light" : "dark"
            render(WorktreePanelView(controller: WorktreePanelController(fixture: panel), isSnapshot: true),
                   width: 760, scheme, out.appendingPathComponent("panel-\(tag).png"))
            render(WorktreePanelView(controller: WorktreePanelController(fixture: catalog), keptOpen: true, isSnapshot: true),
                   width: 760, scheme, out.appendingPathComponent("state-catalog-\(tag).png"))
            render(WorktreeReviewSheet(row: look, controller: WorktreePanelController(fixture: catalog), initialFiles: diff),
                   width: 680, scheme, out.appendingPathComponent("review-sheet-\(tag).png"))
            render(InteractionStatesSnapshot(row: voldemort),
                   width: 1180, scheme, out.appendingPathComponent("interaction-states-\(tag).png"))
        }
        print("wrote 8 snapshots to \(out.path)")
        return true
        #else
        return false
        #endif
    }

    #if DEBUG
    /// `Color(nsColor:)` resolves against the drawing appearance, not the
    /// SwiftUI `colorScheme`, so each scheme renders inside its own appearance.
    @MainActor
    private static func render<V: View>(_ view: V, width: CGFloat, _ scheme: ColorScheme, _ url: URL) {
        let appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)!
        appearance.performAsCurrentDrawingAppearance {
            let content = view
                .environment(\.triageSnapshot, true)
                .frame(width: width)
                .fixedSize(horizontal: false, vertical: true)
                .background(Color(nsColor: .windowBackgroundColor))
                .environment(\.colorScheme, scheme)
            let r = ImageRenderer(content: content)
            r.scale = 2
            guard let cg = r.cgImage else { fatalError("render failed: \(url.lastPathComponent)") }
            let rep = NSBitmapImageRep(cgImage: cg)
            try! rep.representation(using: .png, properties: [:])!.write(to: url)
        }
    }
    #endif
}

#if DEBUG
private struct StateCaption: View {
    let text: String
    var body: some View { Text(text).font(.system(size: 12.5)).foregroundStyle(.secondary) }
}

private struct GroupTitle: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 11.5, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
    }
}

private struct Captioned<Content: View>: View {
    let caption: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            StateCaption(text: caption)
            content
        }
        .fixedSize()
    }
}

struct InteractionStatesSnapshot: View {
    let row: TriageRow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Interaction states").font(.system(size: 21, weight: .semibold))
                .padding(.bottom, 28)

            GroupTitle(text: "BUTTONS").padding(.bottom, 10)
            HStack(alignment: .top, spacing: 16) {
                Captioned(caption: "Secondary · rest") { secondary(.rest) }
                Captioned(caption: "Secondary · hover") { secondary(.hover) }
                Captioned(caption: "Secondary · pressed") { secondary(.pressed) }
                Captioned(caption: "Secondary · disabled") { secondary(.disabled).disabled(true) }
                Captioned(caption: "Secondary · busy") {
                    Button("Dispose") {}.buttonStyle(TriageButtonStyle(busyLabel: "Disposing…", forced: .busy))
                }
                Captioned(caption: "Primary · rest") { primary(.rest) }
                Captioned(caption: "Primary · hover") { primary(.hover) }
                Captioned(caption: "Primary · pressed") { primary(.pressed) }
                Captioned(caption: "Primary · busy") {
                    Button("Push branch") {}.buttonStyle(TriageButtonStyle(primary: true, busyLabel: "Pushing…", forced: .busy))
                }
            }
            .padding(.bottom, 28)

            GroupTitle(text: "BULK BUTTON").padding(.bottom, 10)
            HStack(alignment: .top, spacing: 16) {
                Captioned(caption: "rest") { TriageBulkButton(safe: 2, progress: nil, forced: .rest) {} }
                Captioned(caption: "hover") { TriageBulkButton(safe: 2, progress: nil, forced: .hover) {} }
                Captioned(caption: "busy") { TriageBulkButton(safe: 2, progress: (0, 2), forced: .busy) {} }
            }
            .padding(.bottom, 28)

            GroupTitle(text: "CHIPS (MR AND TICKET ARE LINKS)").padding(.bottom, 10)
            HStack(alignment: .top, spacing: 16) {
                if let mr = row.mr {
                    Captioned(caption: "MR · rest") { TriageMRChip(mr: mr, repo: row.repo) }
                    Captioned(caption: "MR · hover") { TriageMRChip(mr: mr, repo: row.repo, forceHover: true) }
                }
                if let ticket = row.ticket {
                    Captioned(caption: "Ticket · rest") { TriageTicketChip(ticket: ticket) }
                    Captioned(caption: "Ticket · hover") { TriageTicketChip(ticket: ticket, forceHover: true) }
                }
                Captioned(caption: "Push · not a link") {
                    let push = TriageLabels.push(row.push)
                    TriageChip(text: push.text, icon: push.icon)
                }
            }
            .padding(.bottom, 28)

            GroupTitle(text: "ROWS").padding(.bottom, 10)
            VStack(alignment: .leading, spacing: 8) {
                StateCaption(text: "Row · rest")
                TriageRowView(row: row).padding(.bottom, 6)
                StateCaption(text: "Row · hover (surface lifts, border darkens, … gets a hover well)")
                TriageRowView(row: row, forceHover: true).padding(.bottom, 6)
                StateCaption(text: "Row · busy after Dispose (text dims, button becomes a spinner, … disabled)")
                TriageRowView(row: row, busy: true, busyAction: "dispose")
            }
            .frame(width: 758)
        }
        .padding(.horizontal, 32).padding(.top, 32).padding(.bottom, 40)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func secondary(_ state: TriageInteraction) -> some View {
        Button("Dispose") {}.buttonStyle(TriageButtonStyle(forced: state))
    }

    private func primary(_ state: TriageInteraction) -> some View {
        Button("Push branch") {}.buttonStyle(TriageButtonStyle(primary: true, forced: state))
    }
}
#endif
