import Foundation
@testable import MattstackCore

private let runningPrint = """
gui/501/com.mattstack.deck = {
\tactive count = 1
\tpath = (submitted by smd.543)
\ttype = Submitted
\tmanaged_by = com.apple.xpc.ServiceManagement
\tstate = running

\tprogram identifier = Contents/Helpers/deck (mode: 2)
\targuments = {
\t\tContents/Helpers/deck
\t\tserve
\t}

\truns = 3
\tpid = 28479
\timmediate reason = non-ipc demand
\tlast exit code = 0

\tresource coalition = {
\t\tID = 9211
\t\ttype = resource
\t\tstate = active
\t\tname = com.mattstack.deck
\t}
}
"""

private let crashedPrint = """
gui/501/com.mattstack.deck = {
\tactive count = 0
\tpath = (submitted by smd.543)
\ttype = Submitted
\tstate = not running

\truns = 4
\tlast exit code = 78: EX_CONFIG

\tjetsam coalition = {
\t\tstate = active
\t}
}
"""

private let nestedFirstPrint = """
gui/501/com.mattstack.deck = {
\tresource coalition = {
\t\tstate = active
\t}
\tstate = not running
\tlast exit code = 78: EX_CONFIG
}
"""

private func parsedPrint(_ stdout: String, exit: Int32 = 0, stderr: String = "") -> LaunchdJobLookup {
    LaunchdPrint.parse(CommandOutcome(exitCode: exit, stdout: stdout, stderr: stderr))
}

private func describe(_ registration: AgentRegistration, _ lookup: LaunchdJobLookup?) -> String {
    DeckAgentDiagnosis.describe(label: "com.mattstack.deck", registration: registration, lookup: lookup)
}

private let crashed =
    "The deck agent (com.mattstack.deck) is not running (launchd state: not running; last exit code 78)."

let deckAgentDiagnosisChecks: [Check] = [
    Check("deck agent: label follows render-launchagents.sh's daemon-to-deck rename") { c in
        c.expectEqual(DeckAgentDiagnosis.label(forDaemonLabel: "com.mattstack.daemon"), "com.mattstack.deck")
        c.expectEqual(DeckAgentDiagnosis.label(forDaemonLabel: "com.mattstack.daemon.dev"), "com.mattstack.deck.dev")
    },
    Check("deck agent: nested blocks never override top-level keys") { c in
        c.expectEqual(describe(.enabled, parsedPrint(nestedFirstPrint)), crashed)
    },
    Check("deck agent: a crashed job names its exit code") { c in
        c.expectEqual(describe(.enabled, parsedPrint(crashedPrint)), crashed)
    },
    Check("deck agent: a running job names its pid") { c in
        c.expectEqual(describe(.enabled, parsedPrint(runningPrint)),
                      "The deck agent (com.mattstack.deck) is running (pid 28479).")
    },
    Check("deck agent: a running job that printed no pid is still running") { c in
        let print = "gui/501/com.mattstack.deck = {\n\tstate = running\n}\n"
        c.expectEqual(describe(.enabled, parsedPrint(print)), "The deck agent (com.mattstack.deck) is running.")
    },
    Check("deck agent: registration problems are named without asking launchd") { c in
        c.expectEqual(describe(.notRegistered, nil), "The deck agent (com.mattstack.deck) is not registered.")
        c.expectEqual(describe(.requiresApproval, nil),
                      "The deck agent (com.mattstack.deck) is waiting for approval in System Settings > General > Login Items.")
        c.expectEqual(describe(.notFound, nil), "This app has no deck agent (com.mattstack.deck) to start.")
        c.expectEqual(describe(.enabled, nil), "The deck agent (com.mattstack.deck) is registered.")
    },
    Check("deck agent: an enabled agent launchd has not loaded") { c in
        let lookup = parsedPrint("", exit: 113,
                                 stderr: "Could not find service \"com.mattstack.deck\" in domain for user gui: 501")
        c.expectEqual(lookup, .notLoaded)
        c.expectEqual(describe(.enabled, lookup),
                      "The deck agent (com.mattstack.deck) is registered but launchd has not loaded it.")
    },
    Check("deck agent: a failed launchd print is reported with its exit") { c in
        c.expectEqual(describe(.enabled, parsedPrint("", exit: 5, stderr: "boom")),
                      "The deck agent (com.mattstack.deck) is registered; launchd print failed (exit 5).")
    },
]
