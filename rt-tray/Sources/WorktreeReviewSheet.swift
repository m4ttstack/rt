import SwiftUI
import MattstackCore

struct WorktreeReviewSheet: View {
    let row: TriageRow
    @ObservedObject var controller: WorktreePanelController
    /// Tells the panel which verb the row is now busy with.
    let onStart: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.triageSnapshot) private var isSnapshot
    @State private var files: [TriageDiffFile]
    @State private var loaded: Bool

    init(row: TriageRow, controller: WorktreePanelController, initialFiles: [TriageDiffFile] = [],
         onStart: @escaping (String) -> Void = { _ in }) {
        self.row = row
        self.controller = controller
        self.onStart = onStart
        _files = State(initialValue: initialFiles)
        _loaded = State(initialValue: !initialFiles.isEmpty)
    }

    private var subtitle: String {
        let place = [row.tree, row.repoLabel, row.branch].compactMap { $0 }.joined(separator: " · ")
        let noun = row.repo.hasPrefix("github.com/") ? "PR" : "MR"
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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Review uncommitted changes").font(.system(size: 17, weight: .semibold)).foregroundStyle(WT.text)
                Text(subtitle).font(.system(size: 13.5)).foregroundStyle(WT.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 14)
            SheetRule()
            if isSnapshot {
                fileList
            } else {
                ScrollView { fileList }.frame(minHeight: 280, maxHeight: 520)
            }
            SheetRule()
            HStack(spacing: 8) {
                Text("Discarded files stay in the trash for 14 days.")
                    .font(.system(size: 12.5)).foregroundStyle(WT.textTertiary)
                    .lineLimit(1).layoutPriority(-1)
                Spacer(minLength: 8)
                Button("Keep") { onStart("keep"); controller.keep(row); dismiss() }
                    .buttonStyle(TriageButtonStyle())
                Button("Commit and push") { onStart("push-branch"); controller.pushBranch(row, commitDirty: true); dismiss() }
                    .buttonStyle(TriageButtonStyle())
                Button("Discard and dispose") { onStart("dispose"); controller.dispose(row, discard: "all"); dismiss() }
                    .buttonStyle(TriageButtonStyle(primary: true))
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
        }
        .frame(width: 680)
        .background(WT.card)
        .task {
            guard !loaded else { return }
            files = await controller.diff(row)
            loaded = true
        }
    }

    private var fileList: some View {
        VStack(alignment: .leading, spacing: 0) {
            if loaded && files.isEmpty {
                Text("No uncommitted changes left to show.")
                    .font(.system(size: 13)).foregroundStyle(WT.textSecondary).padding(20)
            }
            ForEach(files) { f in
                HStack(spacing: 8) {
                    Image(systemName: f.status == "untracked" ? "doc.badge.plus" : "doc.text")
                        .foregroundStyle(WT.textSecondary)
                    Text(Self.shortPath(f.path)).font(.system(size: 12.5, design: .monospaced)).foregroundStyle(WT.text)
                        .lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 12)
                    Text(Self.stat(f)).font(.system(size: 12.5)).foregroundStyle(WT.textTertiary)
                }
                .padding(.horizontal, 20).padding(.vertical, 9)
                .background(WT.neutralFill)
                SheetRule()
                VStack(alignment: .leading, spacing: 0) {
                    DiffBody(text: f.diff, untracked: f.status == "untracked")
                    if let more = Self.moreLines(f) {
                        Text(more).font(.system(size: 12.5)).foregroundStyle(WT.textTertiary)
                            .padding(.horizontal, 20).padding(.top, 6)
                    }
                }
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(WT.neutralFill)
            }
        }
    }

    /// Keeps the first three directories and the file name, the way the
    /// file bar can show a deep path on one line.
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

private struct SheetRule: View {
    var body: some View { Rectangle().fill(WT.border).frame(height: 1) }
}

struct DiffBody: View {
    let text: String
    let untracked: Bool

    struct Line: Identifiable {
        let id: Int
        let number: Int?
        let marker: Character?
        let text: String
        let isHunk: Bool
    }

    /// Tracked diffs drop git's file headers and number lines from each hunk's
    /// `@@ -a,b +c,d @@` header: new-side numbers for `+` and context, old-side for `-`.
    static func parse(_ text: String, untracked: Bool) -> [Line] {
        var raw = text.components(separatedBy: "\n")
        if raw.last == "" { raw.removeLast() }
        if untracked {
            return raw.enumerated().map { Line(id: $0.offset, number: $0.offset + 1, marker: "+", text: $0.element, isHunk: false) }
        }
        var out: [Line] = []
        var oldLine = 0, newLine = 0, inHunk = false
        for (i, l) in raw.enumerated() {
            if l.hasPrefix("@@") {
                inHunk = true
                let nums = l.split(separator: " ").dropFirst().prefix(2).map { $0.dropFirst().split(separator: ",").first.flatMap { Int($0) } ?? 0 }
                oldLine = nums.first ?? 0
                newLine = nums.count > 1 ? nums[1] : 0
                out.append(Line(id: i, number: nil, marker: nil, text: l, isHunk: true))
                continue
            }
            guard inHunk else { continue }
            switch l.first {
            case "+": out.append(Line(id: i, number: newLine, marker: "+", text: String(l.dropFirst()), isHunk: false)); newLine += 1
            case "-": out.append(Line(id: i, number: oldLine, marker: "-", text: String(l.dropFirst()), isHunk: false)); oldLine += 1
            case "\\": continue
            default:
                out.append(Line(id: i, number: newLine, marker: " ", text: String(l.dropFirst()), isHunk: false))
                oldLine += 1; newLine += 1
            }
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Self.parse(text, untracked: untracked)) { line in
                if line.isHunk {
                    Text(line.text)
                        .font(.system(size: 12, design: .monospaced)).foregroundStyle(WT.textTertiary)
                        .padding(.leading, 20).padding(.vertical, 3)
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
                    .frame(height: 18)
                }
            }
        }
    }
}
