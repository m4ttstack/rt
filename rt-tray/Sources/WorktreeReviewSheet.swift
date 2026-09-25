import SwiftUI
import MattstackCore

struct WorktreeReviewSheet: View {
    let row: TriageRow
    @ObservedObject var controller: WorktreePanelController
    let onStart: (String) -> Void
    let onClose: () -> Void
    @Environment(\.triageSnapshot) private var isSnapshot
    @State private var load: DiffLoadState
    @State private var expanded: Set<String>

    init(row: TriageRow, controller: WorktreePanelController, initialLoad: TriageDiffLoad? = nil,
         expanded: Set<String> = [], onStart: @escaping (String) -> Void = { _ in }, onClose: @escaping () -> Void = {}) {
        self.row = row
        self.controller = controller
        self.onStart = onStart
        self.onClose = onClose
        _load = State(initialValue: initialLoad.map(DiffLoadState.init) ?? .loading)
        _expanded = State(initialValue: expanded)
    }

    private var subtitle: String {
        let place = [row.tree, row.repoLabel, row.branch].compactMap { $0 }.joined(separator: " · ")
        let noun = row.changeNoun
        let one = row.dirt.files.count == 1
        let lead: String
        switch row.mr?.state {
        case "merged": lead = "The \(noun) merged; "
        case "closed": lead = "The \(noun) was closed; "
        default: lead = ""
        }
        let tail = one ? "this file never made it into a commit." : "these files never made it into a commit."
        return "\(place). \(lead.isEmpty ? tail.prefix(1).uppercased() + tail.dropFirst() : lead + tail)"
    }


    private var loaded: Bool { if case .loaded = load { return true } else { return false } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Review uncommitted changes").font(.system(size: 17, weight: .semibold)).foregroundStyle(WT.text)
                Text(subtitle).font(.system(size: 13.5)).foregroundStyle(WT.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 14)
            SheetRule()
            content.frame(maxHeight: .infinity, alignment: .top)
            SheetRule()
            HStack(spacing: 8) {
                Text("Discarded files stay in the trash for 14 days.")
                    .font(.system(size: 12.5)).foregroundStyle(WT.textTertiary)
                    .lineLimit(1).layoutPriority(-1)
                Spacer(minLength: 8)
                Button("Keep") { onStart("keep"); controller.keep(row); onClose() }
                    .buttonStyle(TriageButtonStyle())
                Button("Commit and push") { onStart("push-branch"); controller.pushBranch(row, commitDirty: true); onClose() }
                    .buttonStyle(TriageButtonStyle())
                    .disabled(!loaded)
                Button("Discard and dispose") { onStart("dispose"); controller.dispose(row, discard: "all"); onClose() }
                    .buttonStyle(TriageButtonStyle(primary: true))
                    .disabled(!loaded)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
        }
        .frame(minWidth: 560, maxWidth: .infinity, minHeight: 360, maxHeight: .infinity, alignment: .top)
        .background(WT.card)
        .task {
            if case .loading = load { await reload() }
        }
    }

    @ViewBuilder private var content: some View {
        switch load {
        case .loading:
            Text("Loading changes…")
                .font(.system(size: 13)).foregroundStyle(WT.textTertiary)
                .padding(20)
                .frame(maxWidth: .infinity, minHeight: 280, alignment: .topLeading)
        case .failed:
            HStack(spacing: 12) {
                Text("Couldn't load the changes.").font(.system(size: 13)).foregroundStyle(WT.textSecondary)
                Button("Retry") { Task { await reload() } }.buttonStyle(TriageButtonStyle())
                Spacer(minLength: 0)
            }
            .padding(20)
            .frame(maxWidth: .infinity, minHeight: 280, alignment: .topLeading)
        case .loaded(let files, _) where files.isEmpty:
            Text("No uncommitted changes left to show.")
                .font(.system(size: 13)).foregroundStyle(WT.textSecondary)
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .loaded(let files, let truncatedFiles):
            if isSnapshot {
                fileList(files, truncatedFiles: truncatedFiles, lazy: false)
            } else {
                ScrollView { fileList(files, truncatedFiles: truncatedFiles, lazy: true) }
            }
        }
    }

    private func reload() async {
        load = .loading
        load = await controller.diff(row).map(DiffLoadState.init) ?? .failed
    }

    /// Flat rows, so the live `LazyVStack` only builds the lines on screen.
    /// Only a file's diff body sits on the neutral fill; headers stay on the card.
    private func fileList(_ files: [ParsedDiffFile], truncatedFiles: Bool, lazy: Bool) -> some View {
        DiffStack(lazy: lazy) {
            ForEach(files) { f in
                let open = expanded.contains(f.id)
                DiffFileHeader(file: f.file, open: open) { toggle(f.id, in: files) }
                if open {
                    SheetRule()
                    WT.neutralFill.frame(height: 12)
                    ForEach(f.lines) { DiffLineRow(line: $0) }
                    if let more = f.moreLines {
                        Text(more).font(.system(size: 12.5)).foregroundStyle(WT.textTertiary)
                            .padding(.horizontal, 20).padding(.top, 6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(WT.neutralFill)
                    }
                    WT.neutralFill.frame(height: 12)
                }
                SheetRule()
            }
            if truncatedFiles {
                Text("More files not shown.").font(.system(size: 12.5)).foregroundStyle(WT.textTertiary)
                    .padding(.horizontal, 20).padding(.vertical, 10)
            }
        }
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Option-click opens or closes every file, as a Finder disclosure does.
    private func toggle(_ id: String, in files: [ParsedDiffFile]) {
        let opening = !expanded.contains(id)
        if NSEvent.modifierFlags.contains(.option) {
            expanded = opening ? Set(files.map(\.id)) : []
        } else if opening {
            expanded.insert(id)
        } else {
            expanded.remove(id)
        }
    }

    static func shortPath(_ path: String) -> String {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count > 5 else { return path }
        return (parts.prefix(3) + ["…", parts.last!]).joined(separator: "/")
    }

    /// `untracked · +97`, `modified · +3 −1`; a zero side is left out. A
    /// daemon without the counts leaves them out entirely rather than showing
    /// a count taken from the capped text.
    static func stat(_ f: TriageDiffFile) -> String {
        let parts = [(f.added ?? 0) > 0 ? "+\(f.added!)" : nil, (f.removed ?? 0) > 0 ? "\u{2212}\(f.removed!)" : nil]
        return ([f.status] + parts.compactMap { $0 }).joined(separator: " · ")
    }

    static func moreLines(_ f: TriageDiffFile) -> String? {
        guard f.truncated else { return nil }
        guard let total = f.totalLines else { return "More lines not shown" }
        var shown = f.diff.components(separatedBy: "\n")
        if shown.last == "" { shown.removeLast() }
        let more = total - shown.count
        guard more > 0 else { return nil }
        return more == 1 ? "1 more line" : "\(more) more lines"
    }
}

enum DiffLoadState {
    case loading
    case failed
    case loaded(files: [ParsedDiffFile], truncatedFiles: Bool)

    init(_ result: TriageDiffLoad) {
        self = .loaded(files: result.files.map(ParsedDiffFile.init), truncatedFiles: result.truncatedFiles)
    }
}

struct ParsedDiffFile: Identifiable {
    let file: TriageDiffFile
    let lines: [DiffLine]
    let moreLines: String?
    var id: String { file.path }

    init(_ file: TriageDiffFile) {
        self.file = file
        lines = DiffLine.parse(file.diff, untracked: file.status == "untracked")
        moreLines = WorktreeReviewSheet.moreLines(file)
    }
}

private struct SheetRule: View {
    var body: some View { Rectangle().fill(WT.border).frame(height: 1) }
}

private struct DiffStack<Content: View>: View {
    let lazy: Bool
    @ViewBuilder let content: Content
    var body: some View {
        if lazy {
            LazyVStack(alignment: .leading, spacing: 0) { content }
        } else {
            VStack(alignment: .leading, spacing: 0) { content }
        }
    }
}

struct DiffLine: Identifiable {
    let id: Int
    let number: Int?
    let marker: Character?
    let text: String
    let isHunk: Bool

    /// Tracked diffs drop git's file headers and number lines from each hunk's
    /// `@@ -a,b +c,d @@` header: new-side numbers for `+` and context, old-side
    /// for `-`. A `diff --git` line starts a new section, whose `---`/`+++`
    /// headers must not read as changes.
    static func parse(_ text: String, untracked: Bool) -> [DiffLine] {
        var raw = text.components(separatedBy: "\n")
        if raw.last == "" { raw.removeLast() }
        if untracked {
            return raw.enumerated().map { DiffLine(id: $0.offset, number: $0.offset + 1, marker: "+", text: $0.element, isHunk: false) }
        }
        var out: [DiffLine] = []
        var oldLine = 0, newLine = 0, inHunk = false
        for (i, l) in raw.enumerated() {
            if l.hasPrefix("diff --git ") { inHunk = false; continue }
            if l.hasPrefix("@@") {
                inHunk = true
                let nums = l.split(separator: " ").dropFirst().prefix(2).map { $0.dropFirst().split(separator: ",").first.flatMap { Int($0) } ?? 0 }
                oldLine = nums.first ?? 0
                newLine = nums.count > 1 ? nums[1] : 0
                out.append(DiffLine(id: i, number: nil, marker: nil, text: l, isHunk: true))
                continue
            }
            guard inHunk else { continue }
            switch l.first {
            case "+": out.append(DiffLine(id: i, number: newLine, marker: "+", text: String(l.dropFirst()), isHunk: false)); newLine += 1
            case "-": out.append(DiffLine(id: i, number: oldLine, marker: "-", text: String(l.dropFirst()), isHunk: false)); oldLine += 1
            case "\\": continue
            default:
                out.append(DiffLine(id: i, number: newLine, marker: " ", text: String(l.dropFirst()), isHunk: false))
                oldLine += 1; newLine += 1
            }
        }
        return out
    }
}

private struct DiffFileHeader: View {
    let file: TriageDiffFile
    let open: Bool
    let toggle: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 8) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .rotationEffect(.degrees(open ? 90 : 0))
                    .animation(.easeOut(duration: 0.15), value: open)
                    .foregroundStyle(WT.textTertiary)
                    .frame(width: 12)
                Image(systemName: file.status == "untracked" ? "doc.badge.plus" : "doc.text")
                    .foregroundStyle(WT.textSecondary)
                Text(WorktreeReviewSheet.shortPath(file.path)).font(.system(size: 12.5, design: .monospaced)).foregroundStyle(WT.text)
                    .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 12)
                Text(WorktreeReviewSheet.stat(file)).font(.system(size: 12.5)).foregroundStyle(WT.textTertiary)
            }
            .padding(.leading, 14).padding(.trailing, 20).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(hovered ? WT.cardHover : WT.card)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
    }
}

private struct DiffLineRow: View {
    let line: DiffLine
    var body: some View {
        if line.isHunk {
            Text(line.text)
                .font(.system(size: 12, design: .monospaced)).foregroundStyle(WT.textTertiary)
                .padding(.leading, 20).padding(.vertical, 3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(WT.neutralFill)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(line.number.map(String.init) ?? "")
                    .foregroundStyle(WT.textTertiary)
                    .frame(width: 22, alignment: .trailing)
                Text(line.marker.map(String.init) ?? " ")
                    .foregroundStyle(line.marker == "+" ? WT.green : line.marker == "-" ? WT.red : WT.textTertiary)
                    .frame(width: 30, alignment: .center)
                Text(line.text.isEmpty ? " " : line.text)
                    .foregroundStyle(WT.text)
                    .lineLimit(1)
            }
            .font(.system(size: 12.5, design: .monospaced))
            .padding(.leading, 18).padding(.trailing, 20)
            .frame(maxWidth: .infinity, minHeight: 18, maxHeight: 18, alignment: .leading)
            .background(WT.neutralFill)
        }
    }
}
