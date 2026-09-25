import Foundation
import MattstackCore

let samplePlanJSON = """
{ "contract": 1, "at": "2026-08-21T04:00:00Z",
  "team": { "slug": "acme", "name": "Acme", "mode": "join" },
  "groups": [
    { "id": "mac", "title": "Your Mac", "rows": [
      { "id": "perm.fda", "kind": "permission", "title": "Full Disk Access",
        "why": "Reads your repositories' git state so the daemon can show branch and MR status.",
        "required": true, "optionalNote": null, "status": "needs-you", "detail": "Not granted",
        "action": { "type": "open-settings", "label": "Open Full Disk Access Settings…", "target": "fda" },
        "recheck": "on-activate" },
      { "id": "tool.clt", "kind": "tool", "title": "Apple command line tools", "why": "git and python3.",
        "required": true, "optionalNote": null, "status": "ready", "detail": "git 2.50.1", "action": null, "recheck": "on-change" } ] },
    { "id": "accounts", "title": "Accounts", "rows": [
      { "id": "account.gitlab", "kind": "account", "title": "GitLab", "why": "MRs live on gitlab.example.com.",
        "required": true, "optionalNote": null, "status": "missing", "detail": null,
        "action": { "type": "connect", "label": "Connect", "integration": "gitlab",
                    "fields": [ { "name": "token", "label": "Personal access token", "secret": true, "hint": "scopes: read_api, read_user" } ],
                    "alternatives": [ { "id": "use-gh", "label": "Use gh login" } ] },
        "recheck": "on-change" },
      { "id": "tool.chrome", "kind": "tool", "title": "Google Chrome", "why": "Evidence capture.",
        "required": false, "optionalNote": "Works without this.", "status": "skipped", "detail": null,
        "action": { "type": "future-thing", "label": "?" }, "recheck": "manual" } ] } ],
  "canInstall": false, "requiredMissing": ["perm.fda", "account.gitlab"] }
"""

let planModelsChecks: [Check] = [
    Check("Plan decodes the contract sample") { c in
        let plan = try JSONDecoder().decode(Plan.self, from: Data(samplePlanJSON.utf8))
        c.expectEqual(plan.contract, 1)
        c.expectEqual(plan.team.mode, .join)
        try c.requireEqual(plan.groups.map { $0.rows.count }, [2, 2])
        let fda = plan.groups[0].rows[0], gitlab = plan.groups[1].rows[0]
        c.expectEqual(fda.status, .needsYou)
        c.expectEqual(fda.action?.type, .openSettings)
        c.expectEqual(fda.action?.target, "fda")
        c.expectEqual(fda.recheck, .onActivate)
        c.expectEqual(gitlab.action?.fields?.first?.secret, true)
        c.expectEqual(gitlab.action?.alternatives?.first?.id, "use-gh")
        c.expectEqual(plan.requiredMissing, ["perm.fda", "account.gitlab"])
        c.expectEqual(plan.canInstall, false)
    },
    Check("a connect action carries its create-token link, and reads nil when rt sends none") { c in
        let json = Data(#"{"type":"connect","label":"Connect","integration":"gitlab","fields":[],"create":{"label":"Create a token on GitLab…","url":"https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=read_api"}}"#.utf8)
        let action = try JSONDecoder().decode(RowAction.self, from: json)
        c.expectEqual(action.create, ActionLink(label: "Create a token on GitLab…", url: "https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=read_api"))
        let bare = try JSONDecoder().decode(RowAction.self, from: Data(#"{"type":"connect","label":"Connect","integration":"gitlab","fields":[]}"#.utf8))
        c.expectEqual(bare.create, nil)
    },
    Check("a connect field carries the app's prefill value, and reads nil when rt sends none") { c in
        let prefilled = try JSONDecoder().decode(
            ActionField.self,
            from: Data(#"{"name":"host","label":"Switchboard URL","secret":false,"value":"https://sw.example.com"}"#.utf8))
        c.expectEqual(prefilled.value, "https://sw.example.com")
        let bare = try JSONDecoder().decode(ActionField.self, from: Data(#"{"name":"token","label":"Token"}"#.utf8))
        c.expectEqual(bare.value, nil)
        c.expectEqual(bare.secret, false)
    },
    Check("unknown action type, status, and kind degrade instead of failing the whole plan") { c in
        func chromeRow(_ json: String) throws -> PlanRow {
            let plan = try JSONDecoder().decode(Plan.self, from: Data(json.utf8))
            return try c.requireSome(plan.groups.flatMap(\.rows).first { $0.id == "tool.chrome" },
                                     "the degraded row must survive decoding")
        }
        c.expectEqual(try chromeRow(samplePlanJSON).action?.type, .unknown)
        let lenient = samplePlanJSON.replacingOccurrences(of: "\"status\": \"skipped\"", with: "\"status\": \"brand-new\"")
        c.expectEqual(try chromeRow(lenient).status, .error)
        let lenientKind = samplePlanJSON.replacingOccurrences(of: "\"id\": \"tool.chrome\", \"kind\": \"tool\"",
                                                              with: "\"id\": \"tool.chrome\", \"kind\": \"brand-new-kind\"")
        c.expectEqual(try chromeRow(lenientKind).kind, .info)
    },
    Check("Plan round-trips through the encoder") { c in
        let plan = try JSONDecoder().decode(Plan.self, from: Data(samplePlanJSON.utf8))
        let data = try JSONEncoder().encode(plan)
        let again = try JSONDecoder().decode(Plan.self, from: data)
        c.expectEqual(again, plan)
    },
    Check("finishGated, waived and finishBlockedBy decode, and default to false / false / [] when an older rt omits them") { c in
        let plan = try JSONDecoder().decode(Plan.self, from: Data(samplePlanJSON.utf8))
        c.expectEqual(plan.finishBlockedBy, [])
        c.expect(plan.groups.flatMap(\.rows).allSatisfy { !$0.finishGated && !$0.waived })
        let gated = samplePlanJSON
            .replacingOccurrences(of: "\"id\": \"tool.chrome\", \"kind\": \"tool\",", with: "\"id\": \"tool.chrome\", \"kind\": \"tool\", \"finishGated\": true, \"waived\": true,")
            .replacingOccurrences(of: "\"requiredMissing\": [\"perm.fda\", \"account.gitlab\"]", with: "\"requiredMissing\": [\"perm.fda\", \"account.gitlab\"], \"finishBlockedBy\": [\"tool.chrome\"]")
        let decoded = try JSONDecoder().decode(Plan.self, from: Data(gated.utf8))
        c.expectEqual(decoded.finishBlockedBy, ["tool.chrome"])
        c.expectEqual(decoded.groups.flatMap(\.rows).first { $0.id == "tool.chrome" }?.finishGated, true)
        c.expectEqual(decoded.groups.flatMap(\.rows).first { $0.id == "tool.chrome" }?.waived, true)
        let again = try JSONDecoder().decode(Plan.self, from: JSONEncoder().encode(decoded))
        c.expectEqual(again, decoded)
    },
    Check("an ActionField with no `secret` key decodes as not-secret instead of failing the whole plan") { c in
        let json = Data(#"{"name":"token","label":"Personal access token","hint":"scopes: read_api"}"#.utf8)
        let field = try JSONDecoder().decode(ActionField.self, from: json)
        c.expectEqual(field.secret, false)
        c.expectEqual(field.hint, "scopes: read_api")
        let bare = try JSONDecoder().decode(ActionField.self, from: Data(#"{"name":"handle","label":"Handle"}"#.utf8))
        c.expectEqual(bare.secret, false)
        c.expectEqual(bare.hint, nil)
    },
    Check("choose action decodes options and other; unknown type still decodes") { c in
        let json = """
        {"type":"choose","label":"Choose style…","verb":["skills","writing-style","use"],
         "options":[{"id":"mattstack:writing-style-sparse","label":"Sparse","detail":"Terse.","sample":"**issue:** x"}],
         "selected":"mattstack:writing-style-sparse",
         "other":{"label":"Use my own skill…","hint":"Any installed skill id."}}
        """
        let a = try JSONDecoder().decode(RowAction.self, from: Data(json.utf8))
        c.expectEqual(a.type, .choose)
        c.expectEqual(a.selected, "mattstack:writing-style-sparse")
        c.expectEqual(a.options?.first?.id, "mattstack:writing-style-sparse")
        c.expectEqual(a.options?.first?.sample, "**issue:** x")
        c.expectEqual(a.other?.label, "Use my own skill…")
        c.expectEqual(a.subtitle, nil)
        c.expectEqual(a.footnote, nil)
        c.expectEqual(a.other?.suggestions, nil)
        let u = try JSONDecoder().decode(RowAction.self, from: Data(#"{"type":"future-thing","label":"?"}"#.utf8))
        c.expectEqual(u.type, .unknown)
    },
    Check("choose action decodes subtitle, footnote and other.suggestions when present") { c in
        let json = """
        {"type":"choose","label":"Choose style…","verb":["skills","writing-style","use"],
         "subtitle":"The voice agents use for reviews, replies and PR descriptions posted under your name.",
         "footnote":"You can also choose from a terminal: rt skills writing-style use",
         "options":[{"id":"mattstack:writing-style-sparse","label":"Sparse","detail":"Terse."}],
         "other":{"label":"Use my own skill…","hint":"Any installed skill id.","suggestions":["x:y","team-voice"]}}
        """
        let a = try JSONDecoder().decode(RowAction.self, from: Data(json.utf8))
        c.expectEqual(a.subtitle, "The voice agents use for reviews, replies and PR descriptions posted under your name.")
        c.expectEqual(a.footnote, "You can also choose from a terminal: rt skills writing-style use")
        c.expectEqual(a.other?.suggestions, ["x:y", "team-voice"])
        let again = try JSONDecoder().decode(RowAction.self, from: JSONEncoder().encode(a))
        c.expectEqual(again, a)
    },
    Check("badge: an unskippable finish gate reads required; a skippable one reads optional only once skipped; otherwise optional or nil by `required`") { c in
        func row(finishGated: Bool, waivable: Bool, waived: Bool = false, required: Bool) -> PlanRow {
            PlanRow(id: "r", kind: .tool, title: "t", why: "w", required: required, status: .needsYou,
                    recheck: .onChange, finishGated: finishGated, waived: waived, waivable: waivable)
        }
        c.expectEqual(row(finishGated: true, waivable: false, required: false).badge, .required)
        c.expectEqual(row(finishGated: true, waivable: true, required: false).badge, nil)
        c.expectEqual(row(finishGated: true, waivable: true, waived: true, required: false).badge, .optional)
        c.expectEqual(row(finishGated: false, waivable: false, required: false).badge, .optional)
        c.expectEqual(row(finishGated: false, waivable: false, required: true).badge, nil)
    },
    Check("waivable: absent on a finish-gated row reads true; present is honored") { c in
        func row(_ extra: String) -> String {
            #"{"id":"r","kind":"tool","title":"t","why":"w","required":false,"status":"needs-you","recheck":"on-change""# + extra + "}"
        }
        c.expectEqual(try JSONDecoder().decode(PlanRow.self, from: Data(row(#","finishGated":true"#).utf8)).waivable, true)
        c.expectEqual(try JSONDecoder().decode(PlanRow.self, from: Data(row(#","finishGated":true,"waivable":false"#).utf8)).waivable, false)
        c.expectEqual(try JSONDecoder().decode(PlanRow.self, from: Data(row("").utf8)).waivable, false)
    },
]
