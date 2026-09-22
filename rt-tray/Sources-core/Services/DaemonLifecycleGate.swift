import Foundation

/// The three things anything can ask of the daemon LaunchAgent.
public enum DaemonLifecycleOp: String, Sendable, Codable {
    case start, stop, restart
}

/// Who asked. Every lifecycle log line carries one, so a restart in the log
/// can be told from a restart someone requested over the socket without
/// correlating timestamps against the rt CLI log.
public enum DaemonOrigin {
    /// The tray's own gear menu.
    public static let menu = "gear menu"
    /// A flavor handover retiring this bundle's agent.
    public static let flavorRetire = "flavor retire"

    /// A request that arrived on tray.sock. rt's clients identify themselves
    /// in `X-RT-Client` (`rt-cli/<pid>`, `rt-client/<pid>`); a caller that
    /// sends nothing is named as such rather than silently borrowing the
    /// shape of one that did.
    public static func http(clientHeader: String?) -> String {
        let trimmed = clientHeader?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "socket (unidentified client)" : "socket \(trimmed)"
    }

    /// Case-insensitive header lookup over a raw HTTP request. TrayServer's
    /// legacy route path never parses headers into a dictionary — it matches
    /// on the request line and keeps the whole request as one string — so the
    /// lookup has to work off that string.
    public static func header(_ name: String, in rawRequest: String) -> String? {
        let headerBlock = rawRequest.components(separatedBy: "\r\n\r\n").first ?? rawRequest
        for line in headerBlock.components(separatedBy: "\r\n").dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            guard line[..<colon].lowercased() == name.lowercased() else { continue }
            // Capped: the value lands in every lifecycle log line, and
            // tray.sock accepts requests up to the socket receive limit, so an
            // uncapped value lets one client inflate the log at will.
            let value = String(line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces).prefix(128))
            return value.isEmpty ? nil : value
        }
        return nil
    }
}

/// What the gate tells its owner about lifecycle traffic. Every op emits
/// `entered` before anything can eat it — the 2026-09-21 wedge was only
/// invisible because nothing logged until a body's first action, and the
/// bodies never ran.
public enum DaemonGateEvent: Equatable, Sendable {
    case entered(op: String, origin: String)
    case parked(op: String, origin: String, holder: String)
    case skippedRetired(op: String, origin: String)
    case deadlineExceeded(op: String, origin: String, seconds: TimeInterval)
    /// A body abandoned at its deadline eventually finished anyway.
    case abandonedCompleted(op: String, origin: String)
}

public typealias DaemonGateObserver = @Sendable (DaemonGateEvent) -> Void

/// Serializes daemon LaunchAgent lifecycle work and collapses a herd of
/// concurrent starts into one.
///
/// Both behaviors are the same incident (2026-09-09). A restart whose
/// kickstart fails falls back to unregister-then-register, and every rt client
/// that finds the daemon socket down POSTs `/daemon/start`, which registers
/// and kickstarts. With ~26 watchers those two interleaved: a register landed,
/// the restart's unregister landed next, and the register's own kickstart then
/// failed with "Could not find service …", leaving the job unregistered — the
/// tray reporting "not registered" for ~20s of what should have been a 1s
/// in-place restart.
///
/// So: one op at a time, and a `.start` arriving while a start is already
/// queued or running gets that start's result instead of issuing its own
/// register+kickstart.
public actor DaemonLifecycleGate {
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var startPending = false
    private var startJoiners: [CheckedContinuation<Bool, Never>] = []
    /// Latched by `retire`. Ops that arrive — or were already parked — after
    /// the latch skip their bodies: a start that ran after teardown's
    /// unregister would re-register the agent this app just gave up, leaving
    /// two flavors registered (the situation /flavor/retire exists to end).
    private var isRetired = false
    /// Who holds the slot right now, for the parked event.
    private var holderLabel = ""

    /// A body still running this long past acquire is abandoned: the gate
    /// logs it, reports failure, and frees the slot. INVARIANT: this must
    /// exceed the longest legitimate body — restart's fallback chains two
    /// 60s-bounded kickstarts plus register/unregister — so only something
    /// stuck beyond every inner bound is ever abandoned. Abandoning does
    /// trade serialization for liveness (a late body may run beside one
    /// live op), but holding the slot instead is how three restarts
    /// vanished into a wedged gate forever (2026-09-21).
    private let deadline: TimeInterval
    private nonisolated let observer: DaemonGateObserver?

    /// Check-harness introspection; production code has no business reading
    /// these.
    public var startJoinerCount: Int { startJoiners.count }
    public var waiterCount: Int { waiters.count }

    public init(deadline: TimeInterval = 300, observer: DaemonGateObserver? = nil) {
        // raceBody converts this to UInt64 nanoseconds; a NaN, negative, or
        // absurd value would trap there instead of at the misconfigured call.
        precondition(deadline.isFinite && deadline > 0 && deadline < TimeInterval(UInt64.max) / 1_000_000_000,
                     "gate deadline must be a positive, finite number of seconds")
        self.deadline = deadline
        self.observer = observer
    }

    public func run(_ op: DaemonLifecycleOp, origin: String = "", _ body: @escaping @Sendable () async -> Bool) async -> Bool {
        observer?(.entered(op: op.rawValue, origin: origin))
        if isRetired {
            observer?(.skippedRetired(op: op.rawValue, origin: origin))
            return false
        }
        if op == .start {
            if startPending {
                return await withCheckedContinuation { startJoiners.append($0) }
            }
            startPending = true
        }

        if busy { observer?(.parked(op: op.rawValue, origin: origin, holder: holderLabel)) }
        await acquire()
        // Re-checked after the wait: a retire that took the slot while this op
        // was parked has latched, and the body must not run behind it.
        if isRetired {
            release()
            if op == .start { settleStart(with: false) }
            observer?(.skippedRetired(op: op.rawValue, origin: origin))
            return false
        }
        holderLabel = "\(op.rawValue) (\(origin))"
        let result = await raceBody(op, origin: origin, body)
        holderLabel = ""
        release()

        if op == .start { settleStart(with: result) }
        return result
    }

    /// Runs the body against the deadline. A body that outlives it keeps
    /// running detached — it cannot be cancelled and must not be awaited —
    /// but the gate stops waiting: false is the op's result, and the late
    /// completion is only observed, never re-released.
    private func raceBody(_ op: DaemonLifecycleOp, origin: String,
                          _ body: @escaping @Sendable () async -> Bool) async -> Bool {
        let bodyTask = Task { await body() }
        let settled = OnceFlag()
        let observer = self.observer
        let deadline = self.deadline
        let result: Bool? = await withCheckedContinuation { cont in
            let sleeper = Task {
                try? await Task.sleep(nanoseconds: UInt64(deadline * 1_000_000_000))
                guard settled.take() else { return }
                observer?(.deadlineExceeded(op: op.rawValue, origin: origin, seconds: deadline))
                cont.resume(returning: nil)
            }
            Task {
                let r = await bodyTask.value
                guard settled.take() else {
                    observer?(.abandonedCompleted(op: op.rawValue, origin: origin))
                    return
                }
                sleeper.cancel()
                cont.resume(returning: r)
            }
        }
        return result ?? false
    }

    /// Runs `body` (the teardown unregister) with no other op in flight, then
    /// latches the gate shut: every later or still-parked op no-ops. No
    /// deadline: the teardown unregister is synchronous and must never be
    /// abandoned halfway.
    public func retire(origin: String = "", _ body: @Sendable () async -> Bool) async -> Bool {
        observer?(.entered(op: "retire", origin: origin))
        if busy { observer?(.parked(op: "retire", origin: origin, holder: holderLabel)) }
        await acquire()
        isRetired = true
        let result = await body()
        release()
        return result
    }

    private func settleStart(with result: Bool) {
        startPending = false
        let joiners = startJoiners
        startJoiners = []
        for joiner in joiners { joiner.resume(returning: result) }
    }

    private func acquire() async {
        // A loop, not an `if`: `release` resumes one waiter, but a caller that
        // was never parked can take the slot in between, so the waiter has to
        // re-check rather than assume the slot it was woken for is still free.
        while busy {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in waiters.append(c) }
        }
        busy = true
    }

    private func release() {
        busy = false
        if !waiters.isEmpty { waiters.removeFirst().resume() }
    }
}

/// First `take()` wins; the checked continuation in `raceBody` resumes
/// exactly once no matter how the body and the deadline interleave.
private final class OnceFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var taken = false
    func take() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if taken { return false }
        taken = true
        return true
    }
}
