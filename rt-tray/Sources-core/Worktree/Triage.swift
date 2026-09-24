import Foundation

public struct TriageFingerprint: Codable, Sendable, Equatable {
    public let headSha: String
    public let dirtHash: String
    public let mrState: String?
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
    public var repoLabel: String { repo.split(separator: "/").last.map(String.init) ?? repo }
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
    public static func badge(_ counts: TriageCounts?) -> String? {
        guard let n = counts?.needsDecision, n > 0 else { return nil }
        return "\(n)"
    }
}
