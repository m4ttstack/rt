import AppKit
import Combine
import MattstackCore

struct TriageDiffFile: Decodable, Identifiable {
    let path: String
    let status: String
    let diff: String
    let truncated: Bool
    var id: String { path }
}

private struct ActionReply: Decodable { let ok: Bool; let error: String? }
private struct DiffReply: Decodable { struct D: Decodable { let files: [TriageDiffFile] }; let ok: Bool; let data: D? }

final class WorktreePanelController: ObservableObject {
    @Published var rows: [TriageRow] = []
    @Published var counts: TriageCounts?
    @Published var banners: [TriageBanner] = []
    @Published var status: PanelStatus?
    @Published var busy: Set<String> = []
    @Published var isLoading = true
    /// (done, total) while Clean up N safe works through its rows; nil otherwise.
    @Published var bulkProgress: (Int, Int)?

    private let client = DaemonClient()
    private var timer: Timer?
    private var statusGeneration = 0
    private let fixture: TriageData?

    init(fixture: TriageData? = nil) {
        self.fixture = fixture
        if let f = fixture { rows = f.rows; counts = f.counts; banners = f.banners; isLoading = false }
    }

    func startPolling() {
        guard fixture == nil, timer == nil else { return }
        refresh()
        let t = Timer(timeInterval: 10, repeats: true) { [weak self] _ in self?.refresh() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stopPolling() { timer?.invalidate(); timer = nil }

    func refresh() {
        guard fixture == nil else { return }
        Task {
            let p = await client.queryTriage()
            await MainActor.run {
                isLoading = false
                guard let data = p?.data else {
                    setStatus(p == nil ? "Couldn't reach the daemon" : "Couldn't load worktrees: \(Self.explain(p?.error))", isError: true)
                    return
                }
                rows = data.rows; counts = data.counts; banners = data.banners
            }
        }
    }

    private func run(_ row: TriageRow, _ verb: String, _ payload: [String: Any], done: String) {
        busy.insert(row.id)
        var body = payload
        body["repoName"] = row.repo
        body["tree"] = row.tree
        Task {
            let r: ActionReply? = await client.command(verb, payload: body)
            await MainActor.run {
                busy.remove(row.id)
                if r?.ok == true { setStatus("\(row.tree): \(done)", isError: false) }
                else { setStatus("\(row.tree): \(Self.explain(r?.error))", isError: true) }
                refresh()
            }
        }
    }

    func dispose(_ row: TriageRow, discard: String = "classified", confirmOnlyCopy: Bool = false) {
        run(row, "worktree:triage-dispose", ["fingerprint": row.fingerprint.jsonObject, "discard": discard, "confirmOnlyCopy": confirmOnlyCopy], done: "disposed (restorable for 14 days)")
    }

    /// The daemon leaves "dispose" out of an only-copy row's actions, so the
    /// group, not `actions`, is what makes this offer valid.
    func disposeAnyway(_ row: TriageRow) {
        guard row.group == "only-copy" else { return }
        dispose(row, discard: "all", confirmOnlyCopy: true)
    }

    func keep(_ row: TriageRow) { run(row, "worktree:keep", ["fingerprint": row.fingerprint.jsonObject], done: "kept") }
    func unkeep(_ row: TriageRow) { run(row, "worktree:unkeep", [:], done: "no longer kept") }
    func pushBranch(_ row: TriageRow, commitDirty: Bool = false) {
        run(row, "worktree:push-branch", ["fingerprint": row.fingerprint.jsonObject, "commitDirty": commitDirty], done: "pushed")
    }
    func stopHolders(_ row: TriageRow) { run(row, "worktree:stop-holders", [:], done: "processes stopped") }
    func remove(_ row: TriageRow) { run(row, "worktree:triage-remove", [:], done: "removed") }

    /// One at a time, so the footer and the button can report "1 of 2" and a
    /// refusal on one row doesn't hide behind the others.
    func cleanUpSafe() {
        let safe = rows.filter { $0.group == "safe" }
        guard !safe.isEmpty, bulkProgress == nil else { return }
        bulkProgress = (0, safe.count)
        Task {
            var failures: [String] = []
            for (i, row) in safe.enumerated() {
                await MainActor.run { busy.insert(row.id); bulkProgress = (i, safe.count) }
                let r: ActionReply? = await client.command("worktree:triage-dispose", payload: [
                    "repoName": row.repo, "tree": row.tree, "fingerprint": row.fingerprint.jsonObject, "discard": "classified",
                ])
                await MainActor.run { _ = busy.remove(row.id) }
                if r?.ok != true { failures.append("\(row.tree): \(Self.explain(r?.error))") }
            }
            let failed = failures
            await MainActor.run {
                bulkProgress = nil
                if failed.isEmpty { setStatus("Cleaned up \(safe.count) worktree\(safe.count == 1 ? "" : "s") (restorable for 14 days)", isError: false) }
                else { setStatus(failed.joined(separator: "; "), isError: true) }
                refresh()
            }
        }
    }

    func diff(_ row: TriageRow) async -> [TriageDiffFile] {
        let r: DiffReply? = await client.command("worktree:triage-diff", payload: ["repoName": row.repo, "tree": row.tree])
        return r?.data?.files ?? []
    }

    static func explain(_ error: String?) -> String { TriageRefusal.explain(error) }

    func setStatus(_ text: String, isError: Bool) {
        statusGeneration += 1
        let gen = statusGeneration
        status = PanelStatus(text: text, isError: isError)
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            if self?.statusGeneration == gen { self?.status = nil }
        }
    }
}
