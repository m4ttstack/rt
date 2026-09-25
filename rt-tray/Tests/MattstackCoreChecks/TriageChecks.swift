import Foundation
import MattstackCore

private let json = """
{"ok":true,"data":{"counts":{"needsDecision":3,"safe":1,"waiting":1,"kept":1},"banners":[],
"rows":[
 {"repo":"remote:github.com%2Fm4ttstack%2Frt","tree":"neville","path":"/p/n","branch":"spike","mr":{"iid":342,"state":"closed","title":"Draft: spike","at":null},"ticket":{"identifier":"RT-199","title":"t","stateName":"Canceled"},"push":{"kind":"unpushed","ahead":19},"containment":"none","dirt":{"kind":"none","files":[]},"group":"only-copy","verdict":"Only copy of this work. Push the branch to keep it, or dispose to drop it.","actions":["push-branch","keep","dispose"],"fingerprint":{"headSha":"h","dirtHash":"d","mrState":"closed"}},
 {"repo":"remote:gitlab.com%2Fm4ttstack%2Fapp-kit","tree":"olive","path":"/p/o","branch":"b","mr":{"iid":47,"state":"merged","title":"sync","at":null},"ticket":null,"push":{"kind":"in-main"},"containment":"in-default","dirt":{"kind":"junk","files":[".visual/a.png"]},"group":"safe","verdict":"Every commit is in main.","actions":["dispose"],"fingerprint":{"headSha":"h","dirtHash":"d","mrState":"merged"}},
 {"repo":"remote:github.com%2Fm4ttstack%2Frt","tree":"smaug","path":"/p/s","branch":"b","mr":null,"ticket":null,"push":{"kind":"pushed"},"containment":"on-remote","dirt":{"kind":"none","files":[]},"group":"waiting","verdict":"Waiting: x.","actions":["stop-process"],"hold":{"kind":"process","detail":"x"},"fingerprint":{"headSha":"h","dirtHash":"d","mrState":null}},
 {"repo":"remote:github.com%2Fm4ttstack%2Frt","tree":"daisy","path":"/p/d","branch":null,"mr":null,"ticket":null,"push":{"kind":"unpushed","ahead":0},"containment":"none","dirt":{"kind":"none","files":[]},"group":"broken","verdict":"Gone.","actions":["remove"],"fingerprint":{"headSha":"","dirtHash":"d","mrState":null}},
 {"repo":"remote:github.com%2Fm4ttstack%2Frt","tree":"gollum","path":"/p/g","branch":"r","mr":{"iid":301,"state":"closed","title":"spike","at":null},"ticket":null,"push":{"kind":"unpushed","ahead":4},"containment":"none","dirt":{"kind":"none","files":[]},"group":"kept","verdict":"Kept.","actions":["unkeep"],"keptAt":"2026-09-24T00:00:00Z","fingerprint":{"headSha":"h","dirtHash":"d","mrState":"closed"}}
]}}
"""

let triageChecks: [Check] = [
    Check("triage payload decodes every group") { c in
        let p = try JSONDecoder().decode(TriagePayload.self, from: Data(json.utf8))
        c.expectEqual(p.data?.rows.count, 5)
        c.expectEqual(p.data?.counts.needsDecision, 3)
        c.expectEqual(p.data?.rows.first?.push.ahead, 19)
    },
    Check("sections order needs-decision safe first, then waiting, broken, kept; empty ones dropped") { c in
        let rows = try JSONDecoder().decode(TriagePayload.self, from: Data(json.utf8)).data!.rows
        let s = TriageSection.sections(rows)
        c.expectEqual(s.map { $0.0 }, [.needsDecision, .waiting, .broken, .kept])
        c.expectEqual(s[0].1.map { $0.tree }, ["olive", "neville"])
        c.expectEqual(TriageSection.sections([]).count, 0)
    },
    Check("tones follow the group; kept is neutral") { c in
        let rows = try JSONDecoder().decode(TriagePayload.self, from: Data(json.utf8)).data!.rows
        c.expectEqual(rows.map { TriageTone.tone(for: $0) }, [.risk, .safe, .held, .broken, .kept])
    },
    Check("the menu badge shows needsDecision only when above zero") { c in
        c.expectEqual(TriageMenu.badge(TriageCounts(needsDecision: 4, safe: 2, waiting: 1, kept: 0)), 4)
        c.expectEqual(TriageMenu.badge(TriageCounts(needsDecision: 0, safe: 0, waiting: 3, kept: 1)), nil)
        c.expectEqual(TriageMenu.badge(nil), nil)
    },
    Check("a worktree_triage banner click opens the worktree panel") { c in
        c.expectEqual(NotificationClick.bannerRoute(category: NotificationClick.worktreeTriageCategory, url: nil, paneId: nil), .showWorktreePanel)
        c.expectEqual(NotificationClick.Route.showWorktreePanel.suppressesActivationShow, false)
    },
    Check("triage fingerprint encodes a nil mrState as JSON null, never an omitted key") { c in
        let fp = TriageFingerprint(headSha: "h", dirtHash: "d", mrState: nil)
        let data = try JSONEncoder().encode(fp)
        let out = String(decoding: data, as: UTF8.self)
        c.expect(out.contains(#""mrState":null"#), "expected \"mrState\":null in \(out)")
    },
    Check("a fingerprint request body sends a nil mrState as JSON null") { c in
        let fp = TriageFingerprint(headSha: "h", dirtHash: "d", mrState: nil)
        let data = try JSONSerialization.data(withJSONObject: ["fingerprint": fp.jsonObject], options: [.sortedKeys])
        let out = String(decoding: data, as: UTF8.self)
        c.expectEqual(out, #"{"fingerprint":{"dirtHash":"d","headSha":"h","mrState":null}}"#)
        let merged = TriageFingerprint(headSha: "h", dirtHash: "d", mrState: "merged")
        let mData = try JSONSerialization.data(withJSONObject: merged.jsonObject, options: [.sortedKeys])
        c.expectEqual(String(decoding: mData, as: UTF8.self), #"{"dirtHash":"d","headSha":"h","mrState":"merged"}"#)
    },
    Check("refusal codes read as plain sentences; details survive; unknown codes pass through") { c in
        c.expectEqual(TriageRefusal.explain(nil), "couldn't reach the daemon.")
        c.expectEqual(TriageRefusal.explain("only-copy"), "this is the only copy. Push it first, or use Dispose anyway.")
        c.expectEqual(TriageRefusal.explain("not-disposable:waiting"), "it can't be disposed while it's waiting.")
        c.expectEqual(TriageRefusal.explain("push-failed:rejected: non-fast-forward"), "the push failed: rejected: non-fast-forward")
        c.expectEqual(TriageRefusal.explain("attended"), "someone is attending its MR right now.")
        c.expectEqual(TriageRefusal.explain("something-new:x"), "something-new:x")
    },
    Check("a timed-out action reads as still working, never as an unreachable daemon") { c in
        let t = TriageStatusLine.action(tree: "olive", outcome: .timedOut, done: "pushed")
        c.expectEqual(t, TriageStatusLine(text: "olive: still working. Refresh to check.", isError: false))
        let u = TriageStatusLine.action(tree: "olive", outcome: .unreachable, done: "pushed")
        c.expectEqual(u, TriageStatusLine(text: "olive: couldn't reach the daemon.", isError: true))
        c.expectEqual(TriageStatusLine.action(tree: "olive", outcome: .done, done: "pushed").text, "olive: pushed")
        c.expectEqual(TriageStatusLine.action(tree: "olive", outcome: .refused("busy"), done: "pushed").isError, true)
    },
    Check("action timeouts outlast the daemon: push 660 s, other actions 120 s, the triage read 15 s") { c in
        c.expectEqual(TriageTimeouts.action("worktree:push-branch"), 660)
        c.expectEqual(TriageTimeouts.action("worktree:triage-dispose"), 120)
        c.expectEqual(TriageTimeouts.query, 15)
    },
    Check("clean-up footer: all done keeps the success sentence; mixed names the count and each reason") { c in
        c.expectEqual(TriageStatusLine.bulk(total: 3, failures: []).text, "Cleaned up 3 worktrees (restorable for 14 days)")
        c.expectEqual(TriageStatusLine.bulk(total: 1, failures: []).text, "Cleaned up 1 worktree (restorable for 14 days)")
        let mixed = TriageStatusLine.bulk(total: 3, failures: [(tree: "olive", outcome: .refused("in-use"))])
        c.expectEqual(mixed, TriageStatusLine(text: "Cleaned up 2 of 3. olive: a process is still running inside it. Stop it first.", isError: true))
        let slow = TriageStatusLine.bulk(total: 2, failures: [(tree: "olive", outcome: .timedOut)])
        c.expectEqual(slow, TriageStatusLine(text: "Cleaned up 1 of 2. olive: still working. Refresh to check.", isError: false))
    },
    Check("a background poll never overlaps one in flight; a forced query may, and an older reply never overwrites a newer one") { c in
        var gate = TriageQueryGate()
        let first = gate.begin(force: false)
        c.expectEqual(first, 1)
        c.expectEqual(gate.begin(force: false), nil)
        let second = gate.begin(force: true)
        c.expectEqual(second, 2)
        c.expectEqual(gate.finish(2, succeeded: true), true)
        c.expectEqual(gate.finish(1, succeeded: true), false)
        c.expectEqual(gate.begin(force: false), 3)
        c.expectEqual(gate.finish(3, succeeded: false), true)
        c.expectEqual(gate.begin(force: false), 4)
    },
    Check("a finished action stays busy until a later query lands; applied rows release earlier waiters, a failure only its own") { c in
        var ledger = TriageSettleLedger<String>()
        ledger.wait(2, "neville")
        ledger.wait(3, "olive")
        ledger.wait(4, "smaug")
        c.expectEqual(ledger.settle(1, applied: true), [])
        c.expectEqual(ledger.settle(4, applied: false), ["smaug"])
        c.expectEqual(ledger.settle(3, applied: true), ["neville", "olive"])
        c.expectEqual(ledger.settle(2, applied: false), [])
    },
    Check("dispose anyway asks first, naming the tree and its unpushed commits") { c in
        let rows = try JSONDecoder().decode(TriagePayload.self, from: Data(json.utf8)).data!.rows
        let neville = rows[0]
        c.expectEqual(TriageConfirm.disposeAnywayTitle(neville), "Dispose neville anyway?")
        c.expectEqual(TriageConfirm.disposeAnywayMessage(neville),
                      "This is the only copy of 19 unpushed commits. The files go to the trash for 14 days, but the commits may not be recoverable.")
    },
    Check("a remove footer names the trash path when the daemon returns one") { c in
        c.expectEqual(TriageStatusLine.action(tree: "daisy", outcome: .done, done: TriageStatusLine.removed(trash: "/p/.worktrees/.trash-daisy")).text,
                      "daisy: moved to the trash at /p/.worktrees/.trash-daisy")
        c.expectEqual(TriageStatusLine.removed(trash: nil), "removed")
    },
    Check("push and run refusals read as sentences") { c in
        c.expectEqual(TriageRefusal.explain("not-pushable:safe"), "it has nothing to push while it's safe.")
        c.expectEqual(TriageRefusal.explain("runs-unreadable"), "couldn't confirm no run is active in it.")
        c.expectEqual(TriageRefusal.explain("running-run:run-9 at implement"), "a run is still active in it (run-9 at implement).")
    },
    Check("a remote wire decodes to its label, host and forge marker") { c in
        let gh = RepoIdentity(wire: "remote:github.com%2Fm4ttstack%2Frt")
        c.expectEqual(gh?.kind, .remote)
        c.expectEqual(gh?.id, "github.com/m4ttstack/rt")
        c.expectEqual(gh?.label, "rt")
        c.expectEqual(gh?.host, "github.com")
        c.expectEqual(RepoIdentity.changeMarker("remote:github.com%2Fm4ttstack%2Frt"), "#")
        c.expectEqual(RepoIdentity.changeNoun("remote:github.com%2Fm4ttstack%2Frt"), "PR")
        c.expectEqual(RepoIdentity.label("remote:gitlab.com%2Fm4ttstack%2Fapp-kit"), "app-kit")
        c.expectEqual(RepoIdentity.changeMarker("remote:gitlab.com%2Fm4ttstack%2Fapp-kit"), "!")
        c.expectEqual(RepoIdentity.changeNoun("remote:gitlab.com%2Fm4ttstack%2Fapp-kit"), "MR")
    },
    Check("a path wire decodes to its basename and never reads as GitHub") { c in
        c.expectEqual(RepoIdentity.label("path:%2FUsers%2Fdev%2Fmy%20scratch"), "my scratch")
        c.expectEqual(RepoIdentity(wire: "path:%2FUsers%2Fdev%2Fscratch")?.host, nil)
        c.expectEqual(RepoIdentity.changeMarker("path:%2Fgithub.com%2Fx"), "!")
    },
    Check("a non-canonical identity never decodes; its label passes through unchanged") { c in
        c.expectEqual(RepoIdentity(wire: "github.com/m4ttstack/rt"), nil)
        c.expectEqual(RepoIdentity(wire: "path:../.."), nil)
        c.expectEqual(RepoIdentity(wire: "remote:github.com%2fm4ttstack%2frt"), nil)
        c.expectEqual(RepoIdentity(wire: "branch:x"), nil)
        c.expectEqual(RepoIdentity.label("github.com/m4ttstack/rt"), "github.com/m4ttstack/rt")
        c.expectEqual(RepoIdentity.changeMarker("github.com/m4ttstack/rt"), "!")
    },
    Check("rows and banners label and mark from the wire, not the raw string") { c in
        let rows = try JSONDecoder().decode(TriagePayload.self, from: Data(json.utf8)).data!.rows
        c.expectEqual(rows.map(\.repoLabel), ["rt", "app-kit", "rt", "rt", "rt"])
        c.expectEqual(rows.map(\.changeMarker), ["#", "!", "#", "#", "#"])
        c.expectEqual(rows[1].changeNoun, "MR")
        let banner = try JSONDecoder().decode(TriageBanner.self, from: Data(#"{"repo":"remote:gitlab.com%2Fm4ttstack%2Fapp-kit","reason":"no-token","forge":"gitlab"}"#.utf8))
        c.expectEqual(banner.repoLabel, "app-kit")
    },
]
