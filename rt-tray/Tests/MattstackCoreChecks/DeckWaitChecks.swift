import Foundation
@testable import MattstackCore

private final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: TimeInterval = 0
    func now() -> TimeInterval { lock.lock(); defer { lock.unlock() }; return value }
    func advance(_ by: TimeInterval) { lock.lock(); value += by; lock.unlock() }
}

private final class Tally: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func bump() -> Int { lock.lock(); defer { lock.unlock() }; count += 1; return count }
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
}

private final class Seen: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String] = []
    func add(_ item: String) { lock.lock(); items.append(item); lock.unlock() }
    var all: [String] { lock.lock(); defer { lock.unlock() }; return items }
}

private let crashedAgent =
    "The deck agent (com.mattstack.deck) is not running (launchd state: not running; last exit code 78)."

private func scripted(clock: FakeClock, probeCost: TimeInterval = 0, probes: Tally = Tally(),
                      probe: @escaping @Sendable (Int) -> DeckProbeResult,
                      catalog: @escaping @Sendable () -> Bool = { true }) -> DeckWaitDeps {
    DeckWaitDeps(
        probe: { clock.advance(probeCost); return probe(probes.bump()) },
        loadCatalog: { _ in catalog() },
        diagnoseAgent: { crashedAgent },
        now: { clock.now() },
        sleep: { clock.advance($0) })
}

let deckWaitChecks: [Check] = [
    Check("deck wait: healthz 200 with x-deck-pid is healthy") { c in
        c.expectEqual(DeckHealth.classify(status: 200, deckPid: "4242"), .healthy(pid: "4242"))
    },
    Check("deck wait: a 200 without x-deck-pid is not deck") { c in
        c.expectEqual(DeckHealth.classify(status: 200, deckPid: nil), .answered(status: 200))
        c.expectEqual(DeckHealth.classify(status: 200, deckPid: "  "), .answered(status: 200))
    },
    Check("deck wait: the portless 502 page is not deck") { c in
        c.expectEqual(DeckHealth.classify(status: 502, deckPid: nil), .answered(status: 502))
        c.expectEqual(DeckHealth.classify(status: 502, deckPid: "4242"), .answered(status: 502))
    },
    Check("deck wait: ready on the first healthy probe with a fresh catalog, no sleep") { c in
        let clock = FakeClock()
        let phase = await DeckWait.run(deps: scripted(clock: clock, probe: { _ in .healthy(pid: "1") }))
        c.expectEqual(phase, .ready)
        c.expectEqual(clock.now(), 0)
    },
    Check("deck wait: polls once a second until deck answers") { c in
        let clock = FakeClock()
        let probes = Tally()
        let phase = await DeckWait.run(deps: scripted(clock: clock, probes: probes,
                                                      probe: { $0 < 5 ? .answered(status: 502) : .healthy(pid: "1") }))
        c.expectEqual(phase, .ready)
        c.expectEqual(probes.value, 5)
        c.expectEqual(clock.now(), 4)
    },
    Check("deck wait: healthy deck with a stale catalog is not ready and says so at the deadline") { c in
        let clock = FakeClock()
        let phase = await DeckWait.run(deadline: 10, deps: scripted(clock: clock, probe: { _ in .healthy(pid: "77") },
                                                                    catalog: { false }))
        guard case .unreachable(let reason) = phase else { c.fail("expected unreachable, got \(phase)"); return }
        c.expect(reason.contains("pid 77"), reason)
        c.expect(reason.contains("/api/apps"), reason)
        c.expect(!reason.contains("last exit code"), "a running deck must not be blamed on its agent: \(reason)")
    },
    Check("deck wait: gives up at the deadline even when each probe is slow") { c in
        let clock = FakeClock()
        let probes = Tally()
        let phase = await DeckWait.run(deadline: 90, pollInterval: 1,
                                       deps: scripted(clock: clock, probeCost: 2, probes: probes,
                                                      probe: { _ in .unreachable("The request timed out.") }))
        guard case .unreachable = phase else { c.fail("expected unreachable, got \(phase)"); return }
        c.expect(clock.now() >= 90 && clock.now() < 93, "stopped at \(clock.now())")
        c.expectEqual(probes.value, 31)
    },
    Check("deck wait: a catalog load that takes its whole timeout overruns the deadline by at most one poll") { c in
        let clock = FakeClock()
        let deps = DeckWaitDeps(
            probe: { .healthy(pid: "1") },
            loadCatalog: { _ in clock.advance(DeckWaitTuning.catalogTimeout); return false },
            diagnoseAgent: { crashedAgent },
            now: { clock.now() },
            sleep: { clock.advance($0) })
        let phase = await DeckWait.run(deadline: 90, pollInterval: 1, deps: deps)
        guard case .unreachable = phase else { c.fail("expected unreachable, got \(phase)"); return }
        c.expect(clock.now() >= 90 && clock.now() <= 90 + DeckWaitTuning.catalogTimeout + 1, "stopped at \(clock.now())")
        c.expect(DeckWaitTuning.catalogTimeout + DeckWaitTuning.probeTimeout <= 10,
                 "one late poll may add \(DeckWaitTuning.catalogTimeout + DeckWaitTuning.probeTimeout)s past the deadline")
    },
    Check("deck wait: the catalog load is told which deck answered") { c in
        let clock = FakeClock()
        let seen = Seen()
        let deps = DeckWaitDeps(
            probe: { .healthy(pid: "4242") },
            loadCatalog: { pid in seen.add(pid); return true },
            diagnoseAgent: { crashedAgent },
            now: { clock.now() },
            sleep: { clock.advance($0) })
        c.expectEqual(await DeckWait.run(deps: deps), .ready)
        c.expectEqual(seen.all, ["4242"])
    },
    Check("deck wait: each sentence of the reason starts with a capital") { c in
        for probe: DeckProbeResult in [.answered(status: 502), .unreachable("The request timed out.")] {
            let reason = DeckWait.reason(agent: crashedAgent, lastProbe: probe)
            let rest = reason.dropFirst(crashedAgent.count + 1)
            c.expect(rest.first?.isUppercase == true, reason)
        }
        c.expect(DeckWait.reason(agent: crashedAgent, lastProbe: .healthy(pid: "7")).first?.isUppercase == true)
    },
    Check("deck wait: the unreachable reason carries the agent diagnosis and the last answer") { c in
        let clock = FakeClock()
        let phase = await DeckWait.run(deadline: 3, deps: scripted(clock: clock, probe: { _ in .answered(status: 502) }))
        guard case .unreachable(let reason) = phase else { c.fail("expected unreachable, got \(phase)"); return }
        c.expect(reason.hasPrefix(crashedAgent), reason)
        c.expect(reason.contains("HTTP 502"), reason)
    },
    Check("deck wait: a wait cancelled mid-poll stops probing") { c in
        let probes = Tally()
        let deps = DeckWaitDeps(
            probe: { _ = probes.bump(); return .answered(status: 502) },
            loadCatalog: { _ in false },
            diagnoseAgent: { crashedAgent },
            now: { 0 },
            sleep: { _ in withUnsafeCurrentTask { $0?.cancel() } })
        let phase = await Task { await DeckWait.run(deps: deps) }.value
        c.expectEqual(phase, .waiting)
        c.expectEqual(probes.value, 1)
    },
    Check("deck wait: splash shows only the mark while the stack animates") { c in
        c.expectEqual(SplashPresentation.content(animationDone: false, phase: .waiting), .mark)
        c.expectEqual(SplashPresentation.content(animationDone: false, phase: .ready), .mark)
    },
    Check("deck wait: the spinner appears only after the animation, while deck is not ready") { c in
        c.expectEqual(SplashPresentation.content(animationDone: true, phase: .waiting), .markWithSpinner)
    },
    Check("deck wait: the splash dismisses once animated and ready") { c in
        c.expectEqual(SplashPresentation.content(animationDone: true, phase: .ready), .dismiss)
    },
    Check("deck wait: unreachable shows its reason") { c in
        c.expectEqual(SplashPresentation.content(animationDone: true, phase: .unreachable(reason: "r")),
                      .unreachable(reason: "r"))
    },
]
