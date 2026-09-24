import AppKit
import Combine
import MattstackCore

struct TriageDiffFile: Decodable, Identifiable {
    let path: String
    let status: String
    let diff: String
    let truncated: Bool
    /// Counted over the whole diff before the daemon's line cap; nil from a
    /// daemon older than the counts.
    let added: Int?
    let removed: Int?
    let totalLines: Int?
    var id: String { path }
}

private struct ActionReply: Decodable { let ok: Bool; let error: String? }
private struct DiffReply: Decodable { struct D: Decodable { let files: [TriageDiffFile] }; let ok: Bool; let data: D? }

@MainActor
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
    private var hasLoaded = false
    private let fixture: TriageData?

    init(fixture: TriageData? = nil) {
        self.fixture = fixture
        if let f = fixture { rows = f.rows; counts = f.counts; banners = f.banners; isLoading = false }
    }

    func startPolling() {
        guard fixture == nil, timer == nil else { return }
        refresh()
        let t = Timer(timeInterval: 10, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stopPolling() { timer?.invalidate(); timer = nil }

    /// A failed background poll keeps the last rows and says nothing, so it
    /// never overwrites the footer an action just set.
    func refresh(userInitiated: Bool = false) {
        guard fixture == nil else { return }
        Task {
            let p = await client.queryTriage()
            isLoading = false
            guard let data = p?.data else {
                if userInitiated || !hasLoaded {
                    setStatus(p == nil ? "Couldn't reach the daemon" : "Couldn't load worktrees: \(Self.explain(p?.error))", isError: true)
                }
                return
            }
            hasLoaded = true
            rows = data.rows; counts = data.counts; banners = data.banners
        }
    }

    private func perform(_ verb: String, _ row: TriageRow, _ payload: [String: Any]) async -> TriageActionOutcome {
        var body = payload
        body["repoName"] = row.repo
        body["tree"] = row.tree
        let reply: SocketReply<ActionReply> = await client.command(verb, payload: body, timeout: TriageTimeouts.action(verb))
        switch reply {
        case .value(let r): return r.ok ? .done : .refused(r.error ?? "refused")
        case .timedOut: return .timedOut
        case .unreachable: return .unreachable
        }
    }

    private func run(_ row: TriageRow, _ verb: String, _ payload: [String: Any], done: String) {
        busy.insert(row.id)
        Task {
            let outcome = await perform(verb, row, payload)
            busy.remove(row.id)
            let line = TriageStatusLine.action(tree: row.tree, outcome: outcome, done: done)
            setStatus(line.text, isError: line.isError)
            refresh()
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
            var failures: [(tree: String, outcome: TriageActionOutcome)] = []
            for (i, row) in safe.enumerated() {
                busy.insert(row.id)
                bulkProgress = (i, safe.count)
                let outcome = await perform("worktree:triage-dispose", row, ["fingerprint": row.fingerprint.jsonObject, "discard": "classified"])
                busy.remove(row.id)
                if outcome != .done { failures.append((tree: row.tree, outcome: outcome)) }
            }
            bulkProgress = nil
            let line = TriageStatusLine.bulk(total: safe.count, failures: failures)
            setStatus(line.text, isError: line.isError)
            refresh()
        }
    }

    func diff(_ row: TriageRow) async -> [TriageDiffFile] {
        let verb = "worktree:triage-diff"
        let reply: SocketReply<DiffReply> = await client.command(verb, payload: ["repoName": row.repo, "tree": row.tree],
                                                                  timeout: TriageTimeouts.action(verb))
        return reply.value?.data?.files ?? []
    }

    static func explain(_ error: String?) -> String { TriageRefusal.explain(error) }

    func setStatus(_ text: String, isError: Bool) {
        statusGeneration += 1
        let gen = statusGeneration
        status = PanelStatus(text: text, isError: isError)
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            MainActor.assumeIsolated {
                if self?.statusGeneration == gen { self?.status = nil }
            }
        }
    }
}
