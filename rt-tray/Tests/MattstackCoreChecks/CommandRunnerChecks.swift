import Foundation
import MattstackCore

/// Scripted child process: the check fires its handlers by hand.
private final class FakeSpawn: SpawnBackend, @unchecked Sendable {
    private let lock = NSLock()
    private var handlers: SpawnHandlers?
    private var running = false
    private(set) var killCount = 0
    private(set) var detached = false
    private(set) var startCalled = false
    var startError: Error?

    func start(_ h: SpawnHandlers) throws {
        lock.lock(); defer { lock.unlock() }
        startCalled = true
        if let e = startError { throw e }
        handlers = h
        running = true
    }
    var isRunning: Bool { lock.lock(); defer { lock.unlock() }; return running }
    func forceKill() {
        lock.lock(); killCount += 1; running = false; lock.unlock()
    }
    func detach() { lock.lock(); detached = true; lock.unlock() }

    func emitStdout(_ s: String) { grab()?.stdout(Data(s.utf8)) }
    func eofBoth() { let h = grab(); h?.stdoutEOF(); h?.stderrEOF() }
    func exit(_ code: Int32) {
        lock.lock(); running = false; let h = handlers; lock.unlock()
        h?.exited(code)
    }
    private func grab() -> SpawnHandlers? { lock.lock(); defer { lock.unlock() }; return handlers }
}

/// Captures scheduled timers so the check fires exactly the ones the scenario
/// is about, in the order it chooses.
private final class ManualClock: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [(delay: TimeInterval, work: @Sendable () -> Void)] = []
    var schedule: SpawnScheduler {
        { [self] delay, work in
            lock.lock(); entries.append((delay, work)); lock.unlock()
        }
    }
    /// Fires every timer with exactly this delay that has been armed so far.
    func fire(_ delay: TimeInterval) {
        lock.lock()
        let due = entries.filter { $0.delay == delay }
        entries.removeAll { $0.delay == delay }
        lock.unlock()
        for e in due { e.work() }
    }
    var armedDelays: [TimeInterval] { lock.lock(); defer { lock.unlock() }; return entries.map(\.delay) }
}

/// Starts the driver, waits for it to actually wire the backend, runs the
/// scenario, then awaits the outcome under a bound — a scenario that fails to
/// settle the driver fails the check instead of hanging the suite.
private func drive(_ c: CheckContext, _ fake: FakeSpawn, _ clock: ManualClock,
                   timeout: TimeInterval, _ scenario: @escaping @Sendable () async -> Void) async throws -> CommandOutcome {
    let run = Task { await SpawnDriver.run(backend: fake, timeout: timeout, schedule: clock.schedule) }
    await spinUntil(c, "the driver to start the backend") { fake.startCalled }
    await scenario()
    let bound = Task { () -> CommandOutcome? in
        try? await Task.sleep(nanoseconds: 10_000_000_000)
        return nil
    }
    let winner = await withTaskGroup(of: CommandOutcome?.self, returning: CommandOutcome?.self) { group in
        group.addTask { await run.value }
        group.addTask { await bound.value }
        let first = await group.next() ?? nil
        group.cancelAll()
        bound.cancel()
        return first
    }
    return try c.requireSome(winner, "the driver never settled")
}

/// Yields until the condition holds so handler-thread work lands before the
/// check asserts; fails instead of hanging when it never does.
private func spinUntil(_ c: CheckContext, _ what: String, _ condition: @Sendable () -> Bool) async {
    for _ in 0..<200_000 where !condition() {
        await Task.yield()
    }
    if !condition() { c.fail("timed out waiting for \(what)") }
}

let commandRunnerChecks: [Check] = [
    Check("SpawnDriver settles normally when the child exits and both pipes drain") { c in
        let fake = FakeSpawn(), clock = ManualClock()
        let out = try await drive(c, fake, clock, timeout: 60) {
            fake.emitStdout("hi\n")
            fake.eofBoth()
            fake.exit(0)
        }
        c.expect(out.ok, "exit 0 with drained pipes is success, got exit \(out.exitCode)")
        c.expectEqual(out.stdout, "hi\n")
        c.expectEqual(fake.killCount, 0, "a clean exit must never be killed")
        c.expect(fake.detached, "settling must detach the pipe handlers")
    },

    Check("SpawnDriver kills a child that outlives the timeout and reports the kill") { c in
        let fake = FakeSpawn(), clock = ManualClock()
        let out = try await drive(c, fake, clock, timeout: 30) {
            await spinUntil(c, "the deadline to arm") { clock.armedDelays.contains(30) }
            clock.fire(30)
            await spinUntil(c, "the kill to land") { fake.killCount == 1 }
            // The real backend's termination handler fires after SIGKILL with
            // the signal status; it must not overwrite the timeout code.
            fake.exit(9)
            clock.fire(2)
        }
        c.expect(!out.ok, "a killed child must not read as success")
        c.expectEqual(out.exitCode, 124, "the SIGKILL's own termination status must not mask the timeout")
        c.expect(out.stderr.contains("timed out"), "stderr must say the command timed out, got: \(out.stderr)")
        c.expectEqual(fake.killCount, 1)
    },

    Check("SpawnDriver settles from termination when EOF never arrives (grandchild holds the pipe)") { c in
        let fake = FakeSpawn(), clock = ManualClock()
        let out = try await drive(c, fake, clock, timeout: 60) {
            fake.emitStdout("hi\n")
            fake.exit(0)
            await spinUntil(c, "the EOF grace to arm") { clock.armedDelays.contains(2) }
            clock.fire(2)
        }
        c.expect(out.ok, "the child exited 0; a leaked write end must not turn that into failure or a hang")
        c.expectEqual(out.stdout, "hi\n", "output written before exit must be captured")
        c.expectEqual(fake.killCount, 0, "the child already exited; nothing to kill")
    },

    Check("SpawnDriver's deadline never kills a child whose run already settled") { c in
        let fake = FakeSpawn(), clock = ManualClock()
        let out = try await drive(c, fake, clock, timeout: 30) {
            fake.eofBoth()
            fake.exit(0)
        }
        c.expect(out.ok)
        clock.fire(30)
        clock.fire(2)
        c.expectEqual(fake.killCount, 0, "a late deadline firing must be a no-op after settle")
    },

    Check("SpawnDriver settles with 127 when the spawn itself fails to start") { c in
        let fake = FakeSpawn(), clock = ManualClock()
        fake.startError = NSError(domain: NSCocoaErrorDomain, code: 4, userInfo: [NSLocalizedDescriptionKey: "no such file"])
        let out = try await drive(c, fake, clock, timeout: 30) {}
        c.expectEqual(out.exitCode, 127)
        c.expect(out.stderr.contains("no such file"), "the exec error must land in stderr, got: \(out.stderr)")
    },
]
