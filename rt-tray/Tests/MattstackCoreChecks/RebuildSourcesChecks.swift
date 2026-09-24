import Foundation
import MattstackCore

private let rtRepo = "remote:github.com%2Fm4ttstack%2Frt"

private func tree(_ name: String, kind: String, active: String?, repo: String = rtRepo) -> [String: Any] {
    var t: [String: Any] = ["name": name, "path": "/trees/\(name)", "kind": kind, "branch": "b-\(name)", "repoName": repo]
    if let active { t["lastActiveAt"] = active }
    return t
}

private func payload(_ trees: [[String: Any]]) -> Data {
    try! JSONSerialization.data(withJSONObject: ["ok": true, "data": ["trees": trees]])
}

let rebuildSourcesChecks: [Check] = [
    Check("rebuild sources are the rt repo's trees only, from the daemon's worktree:list payload") { c in
        let data = payload([
            tree("repo-tools", kind: "main", active: "2026-09-24T15:00:00Z"),
            tree("treebeard", kind: "ephemeral", active: "2026-09-24T14:00:00Z"),
            tree("other-app", kind: "ephemeral", active: "2026-09-24T16:00:00Z", repo: "remote:github.com%2Fm4ttstack%2Fapp-kit"),
        ])
        let sources = RebuildSources.parse(data, repoName: rtRepo)
        c.expectEqual(sources.map(\.name), ["repo-tools", "treebeard"])
        c.expectEqual(sources.first?.path, "/trees/repo-tools")
        c.expectEqual(sources.last?.branch, "b-treebeard")
        c.expectEqual(RebuildSources.parse(Data("nope".utf8), repoName: rtRepo), [])
    },
    Check("the menu groups sources into main, a few recent, and the rest tucked away") { c in
        var trees = [tree("repo-tools", kind: "main", active: "2026-09-24T09:00:00Z")]
        for i in 1...9 { trees.append(tree("wt\(i)", kind: "ephemeral", active: "2026-09-24T1\(i % 10):00:00Z")) }
        trees.append(tree("scratchy", kind: "unmanaged", active: nil))
        let groups = RebuildSources.group(RebuildSources.parse(payload(trees), repoName: rtRepo), recentLimit: 5)
        c.expectEqual(groups.main.map(\.name), ["repo-tools"])
        c.expectEqual(groups.recent.map(\.name), ["wt9", "wt8", "wt7", "wt6", "wt5"], "most recently active first")
        c.expectEqual(groups.moreRt.map(\.name), ["wt4", "wt3", "wt2", "wt1"])
        c.expectEqual(groups.moreOther.map(\.name), ["scratchy"])
    },
    Check("few worktrees means nothing is tucked away") { c in
        let trees = [tree("repo-tools", kind: "main", active: nil), tree("a", kind: "ephemeral", active: "2026-09-24T10:00:00Z")]
        let groups = RebuildSources.group(RebuildSources.parse(payload(trees), repoName: rtRepo), recentLimit: 5)
        c.expectEqual(groups.recent.map(\.name), ["a"])
        c.expect(groups.moreRt.isEmpty && groups.moreOther.isEmpty)
    },
]
