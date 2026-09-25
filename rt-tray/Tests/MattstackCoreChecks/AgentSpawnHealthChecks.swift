import Foundation
import MattstackCore

func printed(_ stdout: String, exit: Int32 = 0, stderr: String = "") -> LaunchdJobLookup {
    LaunchdPrint.parse(CommandOutcome(exitCode: exit, stdout: stdout, stderr: stderr))
}

let agentSpawnHealthChecks: [Check] = [
    Check("launchd print: argv prints the label in the gui domain") { c in
        let (exe, args) = LaunchdPrint.arguments(label: "com.mattstack.daemon", uid: 501)
        c.expect(exe.hasPrefix("/bin/") && exe.hasSuffix("ctl"), "launchd's control tool, by absolute path")
        c.expectEqual(args, ["print", "gui/501/com.mattstack.daemon"])
    },
    Check("launchd print: the healthy capture reads its top-level fields") { c in
        c.expectEqual(printed(LaunchdPrintFixtures.healthy), .loaded(LaunchdJobSnapshot(
            state: "running", jobState: "running", lastExitCode: 1, pid: 28474,
            properties: ["partial import", "runatload", "resolve program", "has LWCR"])))
    },
    Check("launchd print: the refused-spawn shape reads exit 78, spawn failed and no pid") { c in
        c.expectEqual(printed(LaunchdPrintFixtures.refusedSpawn), .loaded(LaunchdJobSnapshot(
            state: "not running", jobState: "spawn failed", lastExitCode: 78, pid: nil,
            properties: ["partial import", "runatload", "resolve program", "needs LWCR update"])))
    },
    Check("launchd print: a job that crashed on its own reads exited with its code") { c in
        c.expectEqual(printed(LaunchdPrintFixtures.crashedOnItsOwn), .loaded(LaunchdJobSnapshot(
            state: "not running", jobState: "exited", lastExitCode: 1, pid: nil,
            properties: ["partial import", "runatload", "resolve program", "has LWCR"])))
    },
    Check("launchd print: nested blocks never override a top-level field") { c in
        let text = "gui/501/x = {\n\tstate = not running\n\tresource coalition = {\n\t\tstate = active\n\t\tpid = 9\n\t}\n}\n"
        c.expectEqual(printed(text), .loaded(LaunchdJobSnapshot(state: "not running")))
    },
    Check("launchd print: a job that never exited has no exit code") { c in
        let text = "gui/501/x = {\n\tstate = running\n\tlast exit code = (never exited)\n}\n"
        c.expectEqual(printed(text), .loaded(LaunchdJobSnapshot(state: "running")))
    },
    Check("launchd print: a label the domain does not hold reads as not loaded") { c in
        c.expectEqual(printed("", exit: 113, stderr: LaunchdPrintFixtures.notFound), .notLoaded)
        c.expectEqual(printed(LaunchdPrintFixtures.notFound, exit: 1), .notLoaded)
    },
    Check("launchd print: any other failure or an unrecognised shape reads as unknown") { c in
        c.expectEqual(printed("", exit: 5, stderr: "boom"), .unknown("exit 5"))
        c.expectEqual(printed("nothing a job print would contain\n"), .unknown("unrecognised print shape"))
    },
]
