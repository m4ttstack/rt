import Foundation

public struct TriageFingerprint: Codable, Sendable, Equatable {
    public let headSha: String
    public let dirtHash: String
    public let mrState: String?

    private enum CodingKeys: String, CodingKey { case headSha, dirtHash, mrState }

    public init(headSha: String, dirtHash: String, mrState: String?) {
        self.headSha = headSha; self.dirtHash = dirtHash; self.mrState = mrState
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        headSha = try c.decode(String.self, forKey: .headSha)
        dirtHash = try c.decode(String.self, forKey: .dirtHash)
        mrState = try c.decodeIfPresent(String.self, forKey: .mrState)
    }

    /// The daemon's `sameFingerprint` compares `mrState` by value; a key this
    /// encoder omitted would decode there as `undefined`, which is never
    /// `=== null`, so every MR-less row would compare as changed forever.
    /// `encode`, not `encodeIfPresent`, keeps the key present as JSON `null`.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(headSha, forKey: .headSha)
        try c.encode(dirtHash, forKey: .dirtHash)
        try c.encode(mrState, forKey: .mrState)
    }
}

public struct TriageRow: Decodable, Sendable, Identifiable, Equatable {
    public struct MR: Decodable, Sendable, Equatable { public let iid: Int; public let state: String; public let title: String; public let at: String?; public let url: String? }
    public struct Ticket: Decodable, Sendable, Equatable { public let identifier: String; public let title: String; public let stateName: String?; public let url: String? }
    public struct Push: Decodable, Sendable, Equatable { public let kind: String; public let ahead: Int? }
    public struct Dirt: Decodable, Sendable, Equatable { public let kind: String; public let files: [String] }
    public struct Hold: Decodable, Sendable, Equatable { public let kind: String; public let detail: String }

    public let repo: String
    public let tree: String
    public let path: String
    public let branch: String?
    public let mr: MR?
    public let ticket: Ticket?
    public let push: Push
    public let containment: String
    public let dirt: Dirt
    public let group: String
    public let verdict: String
    public let actions: [String]
    public let hold: Hold?
    public let keptAt: String?
    public let fingerprint: TriageFingerprint

    public var id: String { "\(repo)#\(tree)" }
    public var repoLabel: String { RepoIdentity.label(repo) }
    public var changeMarker: String { RepoIdentity.changeMarker(repo) }
    public var changeNoun: String { RepoIdentity.changeNoun(repo) }
}

public struct TriageCounts: Decodable, Sendable, Equatable {
    public let needsDecision: Int
    public let safe: Int
    public let waiting: Int
    public let kept: Int
    public init(needsDecision: Int, safe: Int, waiting: Int, kept: Int) {
        self.needsDecision = needsDecision; self.safe = safe; self.waiting = waiting; self.kept = kept
    }
}

public struct TriageBanner: Decodable, Sendable {
    public let repo: String
    public let reason: String
    public let forge: String?

    public var repoLabel: String { RepoIdentity.label(repo) }
}

public struct TriageData: Decodable, Sendable {
    public let rows: [TriageRow]
    public let banners: [TriageBanner]
    public let counts: TriageCounts
}

public struct TriagePayload: Decodable, Sendable {
    public let ok: Bool
    public let data: TriageData?
    public let error: String?
}

public enum TriageSection: String, CaseIterable, Sendable {
    case needsDecision, waiting, broken, kept

    private static let decisionOrder = ["safe", "look", "only-copy"]

    public static func sections(_ rows: [TriageRow]) -> [(TriageSection, [TriageRow])] {
        let decision = rows.enumerated()
            .filter { decisionOrder.contains($0.element.group) }
            .sorted { (decisionOrder.firstIndex(of: $0.element.group)!, $0.offset) < (decisionOrder.firstIndex(of: $1.element.group)!, $1.offset) }
            .map { $0.element }
        let all: [(TriageSection, [TriageRow])] = [
            (.needsDecision, decision),
            (.waiting, rows.filter { $0.group == "waiting" }),
            (.broken, rows.filter { $0.group == "broken" }),
            (.kept, rows.filter { $0.group == "kept" }),
        ]
        return all.filter { !$0.1.isEmpty }
    }
}

public enum TriageTone: String, Sendable {
    case safe, look, risk, held, busy, broken, kept

    public static func tone(for row: TriageRow) -> TriageTone {
        switch row.group {
        case "safe": return .safe
        case "look": return .look
        case "only-copy": return .risk
        case "waiting": return row.hold?.kind == "orphan-stopping" ? .busy : .held
        case "broken": return .broken
        default: return .kept
        }
    }
}

public enum MRTone: String, Sendable {
    case merged, closed, open
    public static func of(_ state: String) -> MRTone { state == "merged" ? .merged : state == "closed" ? .closed : .open }
}

public enum TriageMenu {
    public static func badge(_ counts: TriageCounts?) -> Int? {
        guard let n = counts?.needsDecision, n > 0 else { return nil }
        return n
    }
}

extension TriageFingerprint {
    /// For `JSONSerialization` bodies, which throw on a boxed `Optional.none`.
    /// `NSNull` keeps `mrState` present as JSON `null` for the same reason
    /// `encode(to:)` does.
    public var jsonObject: [String: Any] {
        ["headSha": headSha, "dirtHash": dirtHash, "mrState": mrState.map { $0 as Any } ?? NSNull()]
    }
}

/// Each must outlast the daemon's own worst case for the verb: push-branch
/// may commit and then push, each bounded by the daemon's 5 minute mutating
/// git timeout; dispose may fetch for up to a minute first.
public enum TriageTimeouts {
    public static let query: TimeInterval = 15
    public static func action(_ verb: String) -> TimeInterval {
        verb == "worktree:push-branch" ? 660 : 120
    }
}

public enum TriageActionOutcome: Equatable, Sendable {
    case done
    case refused(String)
    /// The daemon got the request and may still finish it.
    case timedOut
    case unreachable
}

public struct TriageStatusLine: Equatable, Sendable {
    public let text: String
    public let isError: Bool

    public init(text: String, isError: Bool) { self.text = text; self.isError = isError }

    public static func reason(_ outcome: TriageActionOutcome) -> String {
        switch outcome {
        case .done: return "done."
        case .refused(let code): return TriageRefusal.explain(code)
        case .timedOut: return "still working. Refresh to check."
        case .unreachable: return TriageRefusal.explain(nil)
        }
    }

    public static func action(tree: String, outcome: TriageActionOutcome, done: String) -> TriageStatusLine {
        switch outcome {
        case .done: return TriageStatusLine(text: "\(tree): \(done)", isError: false)
        case .timedOut: return TriageStatusLine(text: "\(tree): \(reason(outcome))", isError: false)
        case .refused, .unreachable: return TriageStatusLine(text: "\(tree): \(reason(outcome))", isError: true)
        }
    }

    public static func bulk(total: Int, failures: [(tree: String, outcome: TriageActionOutcome)]) -> TriageStatusLine {
        if failures.isEmpty {
            return TriageStatusLine(text: "Cleaned up \(total) worktree\(total == 1 ? "" : "s") (restorable for 14 days)", isError: false)
        }
        let reasons = failures.map { "\($0.tree): \(reason($0.outcome))" }.joined(separator: "; ")
        let onlyTimeouts = failures.allSatisfy { $0.outcome == .timedOut }
        return TriageStatusLine(text: "Cleaned up \(total - failures.count) of \(total). \(reasons)", isError: !onlyTimeouts)
    }
}

/// Daemon refusal codes as the tail of a "<tree>: ..." status line. Codes
/// may carry a ":<detail>" suffix; anything unrecognised is shown verbatim.
public enum TriageRefusal {
    public static func explain(_ error: String?) -> String {
        guard let error else { return "couldn't reach the daemon." }
        let parts = error.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let code = String(parts[0])
        let detail = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
        switch code {
        case "changed": return "it changed since this list loaded. Refreshed."
        case "only-copy": return "this is the only copy. Push it first, or use Dispose anyway."
        case "review-first": return "review the uncommitted files first."
        case "discard-not-allowed": return "only its build leftovers can be discarded."
        case "not-disposable": return detail.isEmpty ? "it can't be disposed right now." : "it can't be disposed while it's \(detail)."
        case "not-keepable": return detail.isEmpty ? "it can't be kept right now." : "it can't be kept while it's \(detail)."
        case "in-use": return "a process is still running inside it. Stop it first."
        case "cwds-unreadable": return "couldn't check for processes inside it. Try again."
        case "no-trash": return "the trash isn't available, so nothing was touched."
        case "remove-failed": return "couldn't move it to the trash."
        case "mount-unavailable": return "its volume isn't mounted right now."
        case "not-broken": return "it isn't broken anymore."
        case "not-held": return "nothing is holding it anymore."
        case "busy": return "another action is already working on it. Try again in a moment."
        case "tree-unknown": return "it no longer exists."
        case "repo-unknown": return "its repo isn't tracked anymore."
        case "running-run": return detail.isEmpty ? "a run is still active in it." : "a run is still active in it (\(detail))."
        case "runs-unreadable": return "couldn't confirm no run is active in it."
        case "attended": return "someone is attending its MR right now."
        case "grace": return "it was claimed moments ago. Try again shortly."
        case "unpushed": return "it has commits that aren't pushed."
        case "dirty": return "it has uncommitted changes."
        case "detached": return "it has no branch to push."
        case "diff-failed": return "couldn't read its changes."
        case "push-failed": return detail.isEmpty ? "the push failed." : "the push failed: \(detail)"
        case "commit-failed": return detail.isEmpty ? "the commit failed." : "the commit failed: \(detail)"
        default: return error
        }
    }
}
