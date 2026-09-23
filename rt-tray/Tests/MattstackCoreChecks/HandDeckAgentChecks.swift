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

/// Yields inside every call so two unserialized preflights interleave.
private final class YieldingRunner: CommandRunner, @unchecked Sendable {
    private let lock = NSLock()
    private var _calls: [[String]] = []
    var calls: [[String]] { lock.withLock { _calls } }
    func run(_ executable: String, _ args: [String]) async -> CommandOutcome {
        lock.withLock { _calls.append(args) }
        for _ in 0..<20 { await Task.yield() }
        return args.first == "print" ? CommandOutcome(exitCode: 0, stdout: handPrint, stderr: "")
                                     : CommandOutcome(exitCode: 0, stdout: "", stderr: "")
    }
}

private final class FakeFS: @unchecked Sendable {
    var files: Set<String>
    var moves: [[String]] = []
    var moveError: Error?
    init(_ files: [String]) { self.files = Set(files) }
    private let lock = NSLock()
    var seam: HandDeckFS {
        HandDeckFS(exists: { path in self.lock.withLock { self.files.contains(path) } },
                   createDirectory: { _ in },
                   move: { from, to in
                       if let e = self.moveError { throw e }
                       self.lock.withLock { self.moves.append([from, to]); self.files.remove(from); self.files.insert(to) }
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
        guard case .failed(let msg, let stage) = out else { c.fail("expected failed, got \(out)"); return }
        c.expect(msg.contains("Input/output error"))
        c.expectEqual(stage, .bootout)
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
        guard case .failed(let msg, let stage) = out else { c.fail("expected failed, got \(out)"); return }
        c.expect(msg.contains("EPERM"))
        c.expectEqual(stage, .archive(bootedOut: false))
    },
    Check("hand deck: a failed archive after a bootout still records the bootout") { c in
        let runner = VerbRunner(["print": CommandOutcome(exitCode: 0, stdout: handPrint, stderr: "")])
        let fs = FakeFS([plist])
        fs.moveError = NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "EPERM"])
        let out = await HandDeckAgent.retire(home: home, uid: 501, runner: runner, fs: fs.seam)
        guard case .failed(_, let stage) = out else { c.fail("expected failed, got \(out)"); return }
        c.expectEqual(stage, .archive(bootedOut: true))
    },
    Check("hand deck: a print that fails for any reason but a missing service archives nothing") { c in
        let runner = VerbRunner(["print": CommandOutcome(exitCode: 5, stdout: "", stderr: "Input/output error")])
        let fs = FakeFS([plist])
        let out = await HandDeckAgent.retire(home: home, uid: 501, runner: runner, fs: fs.seam)
        guard case .failed(let msg, let stage) = out else { c.fail("expected failed, got \(out)"); return }
        c.expect(msg.contains("Input/output error"))
        c.expectEqual(stage, .probe)
        c.expectEqual(fs.moves, [])
        c.expect(!runner.calls.contains { $0.first == "bootout" })
    },
    Check("hand deck: the outcome names itself for the retire reply") { c in
        c.expectEqual(HandDeckRetireOutcome.absent.name, "absent")
        c.expectEqual(HandDeckRetireOutcome.retired(bootedOut: true, archivedTo: retired).name, "retired")
        c.expectEqual(HandDeckRetireOutcome.failed("x", stage: .probe).name, "failed")
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
        c.expect(HandDeckRetireOutcome.failed("x", stage: .archive(bootedOut: true)).freedLoadedLabel)
        c.expect(!HandDeckRetireOutcome.failed("x", stage: .archive(bootedOut: false)).freedLoadedLabel)
        c.expect(!HandDeckRetireOutcome.failed("x", stage: .bootout).freedLoadedLabel)
    },
    Check("hand deck preflight: the label may still be held only when the probe or the bootout failed") { c in
        c.expect(HandDeckRetireOutcome.failed("x", stage: .probe).labelMayBeHeld)
        c.expect(HandDeckRetireOutcome.failed("x", stage: .bootout).labelMayBeHeld)
        c.expect(!HandDeckRetireOutcome.failed("x", stage: .archive(bootedOut: true)).labelMayBeHeld)
        c.expect(!HandDeckRetireOutcome.retired(bootedOut: true, archivedTo: retired).labelMayBeHeld)
        c.expect(!HandDeckRetireOutcome.absent.labelMayBeHeld)
    },
    Check("hand deck notice: nothing to surface unless removal failed") { c in
        let fs = FakeFS([])
        c.expectEqual(HandDeckAgent.blockedNotice(for: .absent, home: home, uid: 501, fs: fs.seam), nil)
        c.expectEqual(HandDeckAgent.blockedNotice(for: .retired(bootedOut: true, archivedTo: retired), home: home, uid: 501, fs: fs.seam), nil)
    },
    Check("hand deck notice: a failed bootout names the reason and boots out before archiving") { c in
        let fs = FakeFS([plist])
        guard let notice = HandDeckAgent.blockedNotice(for: .failed("bootout exited 5: Input/output error", stage: .bootout),
                                                       home: home, uid: 501, fs: fs.seam) else {
            c.fail("expected a notice"); return
        }
        c.expectEqual(notice.summary, "A hand-installed deck agent is blocking the deck helper.")
        c.expectEqual(notice.reason, "bootout exited 5: Input/output error")
        let lines = notice.fixCommand.split(separator: "\n").map(String.init)
        c.expectEqual(lines.count, 2)
        c.expect(lines.first?.hasSuffix("ctl bootout gui/501/com.mattstack.deck") == true)
        c.expect(lines.first?.contains("print gui/501/com.mattstack.deck | grep -cF 'path = \(plist)')\" -gt 0 ] && ") == true)
        c.expectEqual(lines.last, "mkdir -p '/Users/tester/.mattstack/deck' && mv -n '\(plist)' '\(retired)'")
    },
    Check("hand deck notice: an unconfirmed job is never booted out by the fix") { c in
        let fs = FakeFS([plist])
        for stage in [HandDeckFailStage.probe, .archive(bootedOut: false), .archive(bootedOut: true)] {
            let notice = HandDeckAgent.blockedNotice(for: .failed("x", stage: stage), home: home, uid: 501, fs: fs.seam)
            c.expect(notice?.fixCommand.contains("bootout") == false)
            c.expect(notice?.fixCommand.hasPrefix("mkdir -p ") == true)
        }
    },
    Check("hand deck notice: the fix archives to a free path when the base archive exists") { c in
        let fs = FakeFS([plist, retired])
        let notice = HandDeckAgent.blockedNotice(for: .failed("x", stage: .probe), home: home, uid: 501, fs: fs.seam,
                                                 now: { Date(timeIntervalSince1970: 1_700_000_000) })
        c.expect(notice?.fixCommand.hasSuffix("'\(retired).1700000000000'") == true)
    },
    Check("hand deck notice: a quote in the home path stays inside its shell word") { c in
        let fs = FakeFS([])
        let notice = HandDeckAgent.blockedNotice(for: .failed("x", stage: .probe), home: "/Users/o'b", uid: 501, fs: fs.seam)
        c.expect(notice?.fixCommand.hasPrefix("mkdir -p '/Users/o'\\''b/.mattstack/deck' && ") == true)
    },
    Check("hand deck preflight: overlapping registrations run one preflight at a time") { c in
        let runner = YieldingRunner()
        let fs = FakeFS([plist])
        let preflight = HandDeckPreflight()
        async let a = preflight.clearLabel(forHelpers: ["com.mattstack.deck"], home: home, uid: 501, runner: runner, fs: fs.seam)
        async let b = preflight.clearLabel(forHelpers: ["com.mattstack.deck"], home: home, uid: 501, runner: runner, fs: fs.seam)
        let outcomes = await [a, b]
        c.expectEqual(runner.calls, [["print", "gui/501/com.mattstack.deck"], ["bootout", "gui/501/com.mattstack.deck"]])
        c.expect(outcomes.contains(.absent))
        c.expect(outcomes.contains(.retired(bootedOut: true, archivedTo: retired)))
    },
]
