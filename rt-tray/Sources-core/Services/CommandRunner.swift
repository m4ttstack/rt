import Foundation

public struct CommandOutcome: Equatable, Sendable {
    public let exitCode: Int32
    public let stdout: String
    public let stderr: String
    public var ok: Bool { exitCode == 0 }
    public init(exitCode: Int32, stdout: String, stderr: String) {
        self.exitCode = exitCode; self.stdout = stdout; self.stderr = stderr
    }
}

/// The one seam every non-rt subprocess goes through (launchctl, tccutil,
/// the privileged helper, deck). Checks use RecordingCommandRunner; nothing
/// under Tests/ may construct SystemCommandRunner.
public protocol CommandRunner: Sendable {
    func run(_ executable: String, _ args: [String]) async -> CommandOutcome
}

public final class RecordingCommandRunner: CommandRunner, @unchecked Sendable {
    public struct Call: Equatable, Sendable { public let executable: String; public let args: [String] }
    public private(set) var calls: [Call] = []
    public var responses: [String: CommandOutcome] = [:]
    private let lock = NSLock()
    public init() {}
    public func run(_ executable: String, _ args: [String]) async -> CommandOutcome {
        lock.lock(); defer { lock.unlock() }
        calls.append(Call(executable: executable, args: args))
        let key = (executable as NSString).lastPathComponent
        return responses[key] ?? CommandOutcome(exitCode: 127, stdout: "", stderr: "no canned response for \(key)")
    }
}

// MARK: - Spawn driver (the testable orchestration)

/// What SpawnDriver wires into a backend before starting it. Each callback is
/// safe to invoke from any queue.
public struct SpawnHandlers: Sendable {
    public let stdout: @Sendable (Data) -> Void
    public let stderr: @Sendable (Data) -> Void
    public let stdoutEOF: @Sendable () -> Void
    public let stderrEOF: @Sendable () -> Void
    public let exited: @Sendable (Int32) -> Void
}

/// One spawned child, as the driver sees it. The real implementation wraps
/// Foundation.Process; checks drive the orchestration with a scripted fake.
public protocol SpawnBackend: Sendable {
    /// Wire the handlers, then start the child. Throws when the exec fails.
    func start(_ handlers: SpawnHandlers) throws
    var isRunning: Bool { get }
    func forceKill()
    /// Stop delivering pipe callbacks; called once the outcome has settled so
    /// a leaked write end can't keep the machinery alive.
    func detach()
}

/// Injectable timer so the orchestration is testable without real clocks.
public typealias SpawnScheduler = @Sendable (TimeInterval, @escaping @Sendable () -> Void) -> Void

/// Runs one spawn to a guaranteed outcome. Three ways a spawn used to park
/// its caller forever, each now bounded:
///
/// - a child that never exits is killed at `timeout`;
/// - a child that exits while a grandchild holds a pipe's write end never
///   delivers EOF (deck's managed-app relaunches do this), so termination
///   arms an `eofGrace` settle with whatever was collected;
/// - either way the continuation resumes exactly once.
///
/// Behind the daemon lifecycle gate, one such park silently wedged every
/// later start/stop/restart (2026-09-21).
public enum SpawnDriver {

    public static func run(backend: SpawnBackend, timeout: TimeInterval, eofGrace: TimeInterval = 2,
                           schedule: @escaping SpawnScheduler) async -> CommandOutcome {
        await withCheckedContinuation { cont in
            let state = SpawnState()
            let settle: @Sendable () -> Void = {
                guard state.markResumedOnce() else { return }
                backend.detach()
                cont.resume(returning: state.outcome())
            }

            let handlers = SpawnHandlers(
                stdout: { state.appendOut($0) },
                stderr: { state.appendErr($0) },
                stdoutEOF: { if state.leave() { settle() } },
                stderrEOF: { if state.leave() { settle() } },
                exited: { code in
                    state.setExitCode(code)
                    let drained = state.leave()
                    // The EOFs usually follow within milliseconds; when a
                    // grandchild inherited a write end they never come.
                    schedule(eofGrace) { settle() }
                    if drained { settle() }
                }
            )

            schedule(timeout) {
                if state.markTimedOut(), backend.isRunning {
                    state.appendErr(Data("command timed out after \(Int(timeout))s; killed\n".utf8))
                    state.latchTimeoutCode()
                    backend.forceKill()
                }
                schedule(eofGrace) { settle() }
            }

            do {
                try backend.start(handlers)
            } catch {
                state.setExitCode(127)
                state.appendErr(Data(String(describing: error).utf8))
                settle()
            }
        }
    }
}

/// Guards the pieces the driver touches from multiple queues so the checked
/// continuation resumes exactly once and the exit code wins no races.
private final class SpawnState: @unchecked Sendable {
    private let lock = NSLock()
    private var outData = Data()
    private var errData = Data()
    private var code: Int32 = 127
    private var resumed = false
    private var timedOut = false
    private var codeLatched = false
    /// stdout EOF + stderr EOF + exit; all three in means fully drained.
    private var pending = 3

    func appendOut(_ d: Data) { lock.lock(); outData.append(d); lock.unlock() }
    func appendErr(_ d: Data) { lock.lock(); errData.append(d); lock.unlock() }
    func setExitCode(_ c: Int32) {
        lock.lock(); defer { lock.unlock() }
        // After a timeout kill, the SIGKILL's own termination status must not
        // mask the 124 that says why the child died.
        if codeLatched { return }
        code = c
    }
    /// 124, held against the exit status the kill itself produces.
    func latchTimeoutCode() {
        lock.lock(); defer { lock.unlock() }
        codeLatched = true
        code = 124
    }
    /// Returns true when this was the last outstanding leaf.
    func leave() -> Bool {
        lock.lock(); defer { lock.unlock() }
        pending -= 1
        return pending == 0
    }
    func markResumedOnce() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if resumed { return false }
        resumed = true
        return true
    }
    /// True exactly once, and never after the outcome has settled — the
    /// deadline closure must not kill a child whose run already resolved.
    func markTimedOut() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if resumed || timedOut { return false }
        timedOut = true
        return true
    }
    func outcome() -> CommandOutcome {
        lock.lock(); defer { lock.unlock() }
        return CommandOutcome(exitCode: code, stdout: String(decoding: outData, as: UTF8.self), stderr: String(decoding: errData, as: UTF8.self))
    }
}

// MARK: - Real runner

/// Foundation.Process behind the SpawnBackend seam. Draining stdout/stderr as
/// data arrives, rather than after exit, is what keeps a chatty child
/// (launchctl, the privileged helper, deck) from blocking on a full ~64KB
/// pipe buffer.
private final class ProcessSpawnBackend: SpawnBackend, @unchecked Sendable {
    private let process = Process()
    private let out = Pipe()
    private let err = Pipe()

    init(executable: String, args: [String]) {
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = args
        process.standardOutput = out
        process.standardError = err
    }

    func start(_ handlers: SpawnHandlers) throws {
        func drain(_ pipe: Pipe, data: @escaping @Sendable (Data) -> Void, eof: @escaping @Sendable () -> Void) {
            pipe.fileHandleForReading.readabilityHandler = { handle in
                let chunk = handle.availableData
                if chunk.isEmpty {
                    handle.readabilityHandler = nil
                    eof()
                } else {
                    data(chunk)
                }
            }
        }
        drain(out, data: handlers.stdout, eof: handlers.stdoutEOF)
        drain(err, data: handlers.stderr, eof: handlers.stderrEOF)
        process.terminationHandler = { handlers.exited($0.terminationStatus) }
        do {
            try process.run()
        } catch {
            detach()
            throw error
        }
    }

    var isRunning: Bool { process.isRunning }
    func forceKill() { kill(process.processIdentifier, SIGKILL) }
    func detach() {
        out.fileHandleForReading.readabilityHandler = nil
        err.fileHandleForReading.readabilityHandler = nil
    }
}

public struct SystemCommandRunner: CommandRunner {
    /// Upper bound on any single spawn; generous because deck's managed-app
    /// restart legitimately takes ~10s.
    private let timeout: TimeInterval

    public init(timeout: TimeInterval = 60) { self.timeout = timeout }

    public func run(_ executable: String, _ args: [String]) async -> CommandOutcome {
        await SpawnDriver.run(
            backend: ProcessSpawnBackend(executable: executable, args: args),
            timeout: timeout,
            schedule: { delay, work in DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work) }
        )
    }
}

public enum TCCReset {
    public static func arguments(bundleId: String) -> (String, [String]) {
        ("/usr/bin/tccutil", ["reset", "All", bundleId])
    }
}
