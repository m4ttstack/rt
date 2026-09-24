import Foundation
import MattstackCore

private let json = """
{"ok":true,"data":{"counts":{"needsDecision":3,"safe":1,"waiting":1,"kept":1},"banners":[],
"rows":[
 {"repo":"github.com/m4ttstack/rt","tree":"neville","path":"/p/n","branch":"spike","mr":{"iid":342,"state":"closed","title":"Draft: spike","at":null},"ticket":{"identifier":"RT-199","title":"t","stateName":"Canceled"},"push":{"kind":"unpushed","ahead":19},"containment":"none","dirt":{"kind":"none","files":[]},"group":"only-copy","verdict":"Only copy of this work. Push the branch to keep it, or dispose to drop it.","actions":["push-branch","keep","dispose"],"fingerprint":{"headSha":"h","dirtHash":"d","mrState":"closed"}},
 {"repo":"github.com/m4ttstack/app-kit","tree":"olive","path":"/p/o","branch":"b","mr":{"iid":47,"state":"merged","title":"sync","at":null},"ticket":null,"push":{"kind":"in-main"},"containment":"in-default","dirt":{"kind":"junk","files":[".visual/a.png"]},"group":"safe","verdict":"Every commit is in main.","actions":["dispose"],"fingerprint":{"headSha":"h","dirtHash":"d","mrState":"merged"}},
 {"repo":"github.com/m4ttstack/rt","tree":"smaug","path":"/p/s","branch":"b","mr":null,"ticket":null,"push":{"kind":"pushed"},"containment":"on-remote","dirt":{"kind":"none","files":[]},"group":"waiting","verdict":"Waiting: x.","actions":["stop-process"],"hold":{"kind":"process","detail":"x"},"fingerprint":{"headSha":"h","dirtHash":"d","mrState":null}},
 {"repo":"github.com/m4ttstack/rt","tree":"daisy","path":"/p/d","branch":null,"mr":null,"ticket":null,"push":{"kind":"unpushed","ahead":0},"containment":"none","dirt":{"kind":"none","files":[]},"group":"broken","verdict":"Gone.","actions":["remove"],"fingerprint":{"headSha":"","dirtHash":"d","mrState":null}},
 {"repo":"github.com/m4ttstack/rt","tree":"gollum","path":"/p/g","branch":"r","mr":{"iid":301,"state":"closed","title":"spike","at":null},"ticket":null,"push":{"kind":"unpushed","ahead":4},"containment":"none","dirt":{"kind":"none","files":[]},"group":"kept","verdict":"Kept.","actions":["unkeep"],"keptAt":"2026-09-24T00:00:00Z","fingerprint":{"headSha":"h","dirtHash":"d","mrState":"closed"}}
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
        c.expectEqual(TriageMenu.badge(TriageCounts(needsDecision: 4, safe: 2, waiting: 1, kept: 0)), "4")
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
]
