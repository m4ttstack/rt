import Foundation
import MattstackCore

private let home = "/Users/tester"
private let plist = "/Users/tester/Library/LaunchAgents/com.mattstack.deck.plist"
private let retired = "/Users/tester/.mattstack/deck/com.mattstack.deck.plist.retired"
private let handPrint = "gui/501/com.mattstack.deck = {\n\tpath = \(plist)\n\ttype = LaunchAgent\n}"
private let smdPrint = "gui/501/com.mattstack.deck = {\n\tpath = (submitted by smd.340)\n\ttype = Submitted\n}"
private let notLoaded = CommandOutcome(exitCode: 113, stdout: "", stderr: "Could not find service")

/// Answers by subcommand (print / bootout), which RecordingCommandRunner's
/// per-executable responses cannot tell apart.
private final class VerbRunner: CommandRunner, @unchecked Sendable {
    var calls: [[String]] = []
    let answers: [String: CommandOutcome]
    init(_ answers: [String: CommandOutcome]) { self.answers = answers }
    func run(_ executable: String, _ args: [String]) async -> CommandOutcome {
        calls.append(args)
        return answers[args.first ?? ""] ?? CommandOutcome(exitCode: 0, stdout: "", stderr: "")
    }
}

private final class FakeFS: @unchecked Sendable {
    var files: Set<String>
    var moves: [[String]] = []
    var moveError: Error?
    init(_ files: [String]) { self.files = Set(files) }
    var seam: HandDeckFS {
        HandDeckFS(exists: { self.files.contains($0) },
                   createDirectory: { _ in },
                   move: { from, to in
                       if let e = self.moveError { throw e }
                       self.moves.append([from, to]); self.files.remove(from); self.files.insert(to)
                   })
    }
}

let handDeckAgentChecks: [Check] = [
    Check("hand deck: no plist in LaunchAgents touches nothing, not even a print") { c in
        let runner = VerbRunner(["print": CommandOutcome(exitCode: 0, stdout: smdPrint, stderr: "")])
        let fs = FakeFS([])
        let out = await HandDeckAgent.retire(home: home, uid: 501, runner: runner, fs: fs.seam)
        c.expectEqual(out, .absent)
        c.expectEqual(runner.calls, [])
    },
    Check("hand deck: a loaded hand agent is booted out, then archived") { c in
        let runner = VerbRunner(["print": CommandOutcome(exitCode: 0, stdout: handPrint, stderr: "")])
        let fs = FakeFS([plist])
        let out = await HandDeckAgent.retire(home: home, uid: 501, runner: runner, fs: fs.seam)
        c.expectEqual(out, .retired(bootedOut: true, archivedTo: retired))
        c.expectEqual(runner.calls, [["print", "gui/501/com.mattstack.deck"], ["bootout", "gui/501/com.mattstack.deck"]])
        c.expectEqual(fs.moves, [[plist, retired]])
    },
    Check("hand deck: an SMAppService job under the same label is never booted out") { c in
        let runner = VerbRunner(["print": CommandOutcome(exitCode: 0, stdout: smdPrint, stderr: "")])
        let fs = FakeFS([plist])
        let out = await HandDeckAgent.retire(home: home, uid: 501, runner: runner, fs: fs.seam)
        c.expectEqual(out, .retired(bootedOut: false, archivedTo: retired))
        c.expect(!runner.calls.contains { $0.first == "bootout" })
    },
    Check("hand deck: an unloaded plist is archived without a bootout") { c in
        let runner = VerbRunner(["print": notLoaded])
        let fs = FakeFS([plist])
        let out = await HandDeckAgent.retire(home: home, uid: 501, runner: runner, fs: fs.seam)
        c.expectEqual(out, .retired(bootedOut: false, archivedTo: retired))
    },
    Check("hand deck: a failed bootout leaves the plist in place") { c in
        let runner = VerbRunner(["print": CommandOutcome(exitCode: 0, stdout: handPrint, stderr: ""),
                                 "bootout": CommandOutcome(exitCode: 5, stdout: "", stderr: "Input/output error")])
        let fs = FakeFS([plist])
        let out = await HandDeckAgent.retire(home: home, uid: 501, runner: runner, fs: fs.seam)
        guard case .failed(let msg) = out else { c.fail("expected failed, got \(out)"); return }
        c.expect(msg.contains("Input/output error"))
        c.expectEqual(fs.moves, [])
    },
    Check("hand deck: an existing archive is never clobbered") { c in
        let runner = VerbRunner(["print": notLoaded])
        let fs = FakeFS([plist, retired])
        let out = await HandDeckAgent.retire(home: home, uid: 501, runner: runner, fs: fs.seam,
                                             now: { Date(timeIntervalSince1970: 1_700_000_000) })
        c.expectEqual(out, .retired(bootedOut: false, archivedTo: retired + ".1700000000000"))
        c.expect(fs.files.contains(retired))
    },
    Check("hand deck: a failed archive move is reported") { c in
        let runner = VerbRunner(["print": notLoaded])
        let fs = FakeFS([plist])
        fs.moveError = NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "EPERM"])
        let out = await HandDeckAgent.retire(home: home, uid: 501, runner: runner, fs: fs.seam)
        guard case .failed(let msg) = out else { c.fail("expected failed, got \(out)"); return }
        c.expect(msg.contains("EPERM"))
    },
    Check("hand deck: the outcome names itself for the retire reply") { c in
        c.expectEqual(HandDeckRetireOutcome.absent.name, "absent")
        c.expectEqual(HandDeckRetireOutcome.retired(bootedOut: true, archivedTo: retired).name, "retired")
        c.expectEqual(HandDeckRetireOutcome.failed("x").name, "failed")
    },
    Check("hand deck preflight: a helper set without the prod deck label touches nothing") { c in
        let runner = VerbRunner(["print": CommandOutcome(exitCode: 0, stdout: handPrint, stderr: "")])
        let fs = FakeFS([plist])
        let out = await HandDeckAgent.clearLabel(forHelpers: ["com.mattstack.daemon.dev", "com.mattstack.deck.dev"],
                                                 home: home, uid: 501, runner: runner, fs: fs.seam)
        c.expectEqual(out, nil)
        c.expectEqual(runner.calls, [])
        c.expectEqual(fs.moves, [])
    },
    Check("hand deck preflight: the prod deck helper clears a loaded hand agent before registering") { c in
        let runner = VerbRunner(["print": CommandOutcome(exitCode: 0, stdout: handPrint, stderr: "")])
        let fs = FakeFS([plist])
        let out = await HandDeckAgent.clearLabel(forHelpers: ["com.mattstack.daemon", "com.mattstack.deck"],
                                                 home: home, uid: 501, runner: runner, fs: fs.seam)
        c.expectEqual(out, .retired(bootedOut: true, archivedTo: retired))
        c.expectEqual(runner.calls, [["print", "gui/501/com.mattstack.deck"], ["bootout", "gui/501/com.mattstack.deck"]])
        c.expectEqual(fs.moves, [[plist, retired]])
    },
    Check("hand deck preflight: an unloaded hand plist is archived so the next login cannot load it") { c in
        let runner = VerbRunner(["print": notLoaded])
        let fs = FakeFS([plist])
        let out = await HandDeckAgent.clearLabel(forHelpers: ["com.mattstack.deck"],
                                                 home: home, uid: 501, runner: runner, fs: fs.seam)
        c.expectEqual(out, .retired(bootedOut: false, archivedTo: retired))
        c.expect(!runner.calls.contains { $0.first == "bootout" })
    },
    Check("hand deck preflight: only a booted-out hand agent means the helper lost the label") { c in
        c.expect(HandDeckRetireOutcome.retired(bootedOut: true, archivedTo: retired).freedLoadedLabel)
        c.expect(!HandDeckRetireOutcome.retired(bootedOut: false, archivedTo: retired).freedLoadedLabel)
        c.expect(!HandDeckRetireOutcome.absent.freedLoadedLabel)
        c.expect(!HandDeckRetireOutcome.failed("x").freedLoadedLabel)
    },
]
