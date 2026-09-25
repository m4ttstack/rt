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

/// Every verb's `data` differs; only triage-remove's `trash.path` is read,
/// and a shape that doesn't carry it must never fail the whole reply.
private struct ActionReply: Decodable {
    private struct Trash: Decodable { let path: String }
    private struct Payload: Decodable { let trash: Trash? }
    private enum CodingKeys: String, CodingKey { case ok, error, data }

    let ok: Bool
    let error: String?
    let trashPath: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try c.decode(Bool.self, forKey: .ok)
        error = try c.decodeIfPresent(String.self, forKey: .error)
        trashPath = (try? c.decodeIfPresent(Payload.self, forKey: .data))??.trash?.path
    }
}
struct TriageDiffLoad {
    let files: [TriageDiffFile]
    /// The daemon lists at most 50 files and says so without a total.
    let truncatedFiles: Bool
}

private struct DiffReply: Decodable {
    struct D: Decodable { let files: [TriageDiffFile]; let truncatedFiles: Bool? }
    let ok: Bool
    let data: D?
}

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
    private var queryGate = TriageQueryGate()
    /// A finished action keeps its row busy until a query started after it lands.
    private var settling = TriageSettleLedger<() -> Void>()
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
    /// never overwrites the footer an action just set. `force` starts a query
    /// even while a poll is in flight, so a finished action's rows are never
    /// left to a poll that began before it. `settled` runs in the same update
    /// that applies this query's rows (or a newer query's), or once it fails.
    func refresh(userInitiated: Bool = false, force: Bool = false, settled: (() -> Void)? = nil) {
        guard fixture == nil, let ticket = queryGate.begin(force: userInitiated || force || settled != nil) else { settled?(); return }
        if let settled { settling.wait(ticket, settled) }
        Task {
            let p = await client.queryTriage()
            let current = queryGate.finish(ticket, succeeded: p?.data != nil)
            defer { settling.settle(ticket, applied: current && p?.data != nil).forEach { $0() } }
            guard current else { return }
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
        await performReply(verb, row, payload).outcome
    }

    private func performReply(_ verb: String, _ row: TriageRow, _ payload: [String: Any]) async -> (outcome: TriageActionOutcome, trashPath: String?) {
        var body = payload
        body["repoName"] = row.repo
        body["tree"] = row.tree
        let reply: SocketReply<ActionReply> = await client.command(verb, payload: body, timeout: TriageTimeouts.action(verb))
        switch reply {
        case .value(let r): return (r.ok ? .done : .refused(r.error ?? "refused"), r.trashPath)
        case .timedOut: return (.timedOut, nil)
        case .unreachable: return (.unreachable, nil)
        }
    }

    private func run(_ row: TriageRow, _ verb: String, _ payload: [String: Any], done: String) {
        run(row, verb, payload) { _ in done }
    }

    private func run(_ row: TriageRow, _ verb: String, _ payload: [String: Any], done: @escaping (String?) -> String) {
        busy.insert(row.id)
        Task {
            let (outcome, trashPath) = await performReply(verb, row, payload)
            let line = TriageStatusLine.action(tree: row.tree, outcome: outcome, done: done(trashPath))
            setStatus(line.text, isError: line.isError)
            if outcome == .done {
                refresh(force: true) { [weak self] in self?.busy.remove(row.id) }
            } else {
                busy.remove(row.id)
                refresh(force: true)
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
    func remove(_ row: TriageRow) { run(row, "worktree:triage-remove", [:], done: TriageStatusLine.removed(trash:)) }

    /// One at a time, so the footer and the button can report "1 of 2" and a
    /// refusal on one row doesn't hide behind the others.
    func cleanUpSafe() {
        let safe = rows.filter { $0.group == "safe" && !busy.contains($0.id) }
        guard !safe.isEmpty, bulkProgress == nil else { return }
        bulkProgress = (0, safe.count)
        Task {
            var failures: [(tree: String, outcome: TriageActionOutcome)] = []
            var disposed: [String] = []
            for (i, row) in safe.enumerated() {
                busy.insert(row.id)
                bulkProgress = (i, safe.count)
                let outcome = await perform("worktree:triage-dispose", row, ["fingerprint": row.fingerprint.jsonObject, "discard": "classified"])
                if outcome == .done {
                    disposed.append(row.id)
                } else {
                    busy.remove(row.id)
                    failures.append((tree: row.tree, outcome: outcome))
                }
            }
            let line = TriageStatusLine.bulk(total: safe.count, failures: failures)
            setStatus(line.text, isError: line.isError)
            refresh(force: true) { [weak self] in
                self?.busy.subtract(disposed)
                self?.bulkProgress = nil
            }
        }
    }

    /// nil when the daemon was unreachable, timed out or refused, so a failed
    /// load never reads as a tree with nothing left to review.
    func diff(_ row: TriageRow) async -> TriageDiffLoad? {
        let verb = "worktree:triage-diff"
        let reply: SocketReply<DiffReply> = await client.command(verb, payload: ["repoName": row.repo, "tree": row.tree],
                                                                  timeout: TriageTimeouts.action(verb))
        guard let r = reply.value, r.ok, let d = r.data else { return nil }
        return TriageDiffLoad(files: d.files, truncatedFiles: d.truncatedFiles ?? false)
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
