import Foundation

/// The repo-tools trees the dev app can rebuild from, as the daemon's
/// `worktree:list` reports them (the daemon, not the tray, reads the git
/// checkouts, so listing them never asks for Documents access).
public struct RebuildSource: Equatable, Sendable {
    public let name: String
    public let path: String
    public let branch: String?
    public let kind: String
    public let lastActiveAt: String?
}

/// The daemon's `worktree:list` reply, as far as the rebuild menu needs it.
public struct WorktreeListPayload: Decodable, Sendable {
    public struct Row: Decodable, Sendable {
        let name: String
        let path: String
        let branch: String?
        let kind: String?
        let repoName: String?
        let lastActiveAt: String?
    }
    public struct Inner: Decodable, Sendable { let trees: [Row] }
    public let ok: Bool
    public let data: Inner?
}

public enum RebuildSources {
    public struct Groups: Equatable, Sendable {
        public let main: [RebuildSource]
        public let recent: [RebuildSource]
        public let moreRt: [RebuildSource]
        public let moreOther: [RebuildSource]
    }

    public static func parse(_ data: Data, repoName: String) -> [RebuildSource] {
        guard let payload = try? JSONDecoder().decode(WorktreeListPayload.self, from: data) else { return [] }
        return sources(from: payload, repoName: repoName)
    }

    public static func sources(from payload: WorktreeListPayload, repoName: String) -> [RebuildSource] {
        guard payload.ok, let trees = payload.data?.trees else { return [] }
        return trees.filter { $0.repoName == repoName }.map {
            RebuildSource(name: $0.name, path: $0.path, branch: $0.branch, kind: $0.kind ?? "", lastActiveAt: $0.lastActiveAt)
        }
    }

    /// ISO-8601 timestamps sort lexically; a tree never active sorts last.
    public static func group(_ sources: [RebuildSource], recentLimit: Int) -> Groups {
        let main = sources.filter { $0.kind == "main" }
        let rest = sources.filter { $0.kind != "main" }.sorted { ($0.lastActiveAt ?? "") > ($1.lastActiveAt ?? "") }
        let recent = Array(rest.prefix(recentLimit))
        let older = rest.dropFirst(recentLimit)
        return Groups(main: main, recent: recent,
                      moreRt: older.filter { $0.kind == "ephemeral" },
                      moreOther: older.filter { $0.kind != "ephemeral" })
    }
}
