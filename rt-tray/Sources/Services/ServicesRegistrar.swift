import Foundation
import ServiceManagement
import MattstackCore

/// Registers every agent plist the bundle ships (spec §8/§9) and restarts
/// them when the app's version changes. Spawns only through CommandRunner.
final class ServicesRegistrar: ServicesProviding, @unchecked Sendable {
    let bundlePath: String
    /// The agents this bundle can actually run. A plist whose BundleProgram
    /// isn't shipped is excluded here on purpose — it would sit at
    /// `notRegistered` forever, and every consumer of these statuses takes the
    /// worst one (login-items permission → requiredMissing → Install disabled,
    /// limited mode unreachable, the version-change record never written).
    let agents: [AgentPlist]
    /// Every plist scanned, filtered or not: `POST /services/register` answers
    /// about whatever plists rt names, and its reply has to say why a skipped
    /// one won't be registered rather than claim the bundle doesn't ship it.
    private let scanned: [AgentPlist]
    private let runner: CommandRunner
    /// Bounded well under an answer budget: one hung `deck list` must not
    /// eat the whole wait.
    private let probeRunner: CommandRunner
    private let uid: uid_t
    private let handDeckPreflight = HandDeckPreflight()
    /// Called on the main actor after every hand-agent preflight, with nil
    /// once nothing blocks the deck helper.
    var onHandDeckBlocked: (@MainActor (HandDeckBlockedNotice?) -> Void)?

    init(bundlePath: String, runner: CommandRunner,
         probeRunner: CommandRunner = SystemCommandRunner(timeout: 5), uid: uid_t = getuid()) {
        self.bundlePath = bundlePath
        self.runner = runner
        self.probeRunner = probeRunner
        self.uid = uid
        let dir = bundlePath + "/Contents/Library/LaunchAgents"
        scanned = ServicePlistScanner.scan(directory: dir, list: ServicePlistScanner.systemList,
                                           readLabel: ServicePlistScanner.systemReadLabel,
                                           readBundleProgram: ServicePlistScanner.systemReadBundleProgram)
        let split = ServiceProgramGuard.partition(scanned, bundlePath: bundlePath,
                                                  exists: { FileManager.default.isExecutableFile(atPath: $0) })
        agents = split.runnable
        if !split.skipped.isEmpty {
            TrayLog.warn("agents skipped; BundleProgram not in bundle",
                         ["labels": split.skipped.map(\.label).joined(separator: ",")])
        }
    }

    private func service(_ plist: AgentPlist) -> SMAppService { SMAppService.agent(plistName: plist.fileName) }

    func smStatuses() -> [SMAppService.Status] { agents.map { service($0).status } }

    @discardableResult
    func registerAll() async -> [ServiceRegisterResult] { await register(plists: agents.map(\.fileName)) }

    /// launchd keeps the definition it bootstrapped, so an agent whose shipped
    /// plist changed is unregistered and registered again first; the daemon
    /// goes through `reregisterDaemon` so its lifecycle gate covers the gap.
    /// `registerAll` then puts back any agent a failed re-register left
    /// unregistered.
    func registerAllAtLaunch(store: KeyValueStore, daemonLabel: String,
                             reregisterDaemon: () async -> Bool) async -> LaunchRegistration {
        let dir = bundlePath + "/Contents/Library/LaunchAgents"
        let before = agents.map { Self.registration(service($0).status) }
        let plan = AgentPlistRefresh.plan(zip(agents, before).map { agent, registration in
            AgentPlistState(label: agent.label,
                            bundleHash: FileManager.default.contents(atPath: dir + "/" + agent.fileName)
                                .map(AgentPlistRefresh.hash),
                            recordedHash: store.string(forKey: AgentPlistRefresh.storeKey(label: agent.label)),
                            registration: registration)
        })
        var reregistered: [String: Bool] = [:]
        for (agent, entry) in zip(agents, plan) {
            guard case .reregister = entry.action else { continue }
            TrayLog.info("agent plist changed; re-registering", ["label": agent.label])
            let ok = agent.label == daemonLabel ? await reregisterDaemon() : await reregister(agent)
            reregistered[agent.label] = ok
            if !ok { TrayLog.warn("agent plist change not applied; retrying next launch", ["label": agent.label]) }
        }
        let results = await registerAll()
        var outcomes: [LaunchAgentOutcome] = []
        for (index, agent) in agents.enumerated() {
            outcomes.append(LaunchAgentOutcome(
                label: agent.label, action: plan[index].action, before: before[index],
                reregistered: reregistered[agent.label],
                registerOk: index < results.count && results[index].ok,
                after: Self.registration(service(agent).status)))
        }
        return LaunchRecording.summarize(outcomes)
    }

    private func reregister(_ agent: AgentPlist) async -> Bool {
        let svc = service(agent)
        let outcome = await AgentReregister.run(
            unregister: { await self.unregister(plists: [agent.fileName]).allSatisfy(\.ok) },
            drain: { _ = await self.waitForJobToLeave(label: agent.label) },
            settle: { try? await Task.sleep(nanoseconds: AgentReregister.settleNanoseconds) },
            register: { await self.register(plists: [agent.fileName]).allSatisfy(\.ok) },
            beforeRetry: { try? await Task.sleep(nanoseconds: AgentReregister.retryPauseNanoseconds) },
            start: { _ = await self.start(label: agent.label) })
        let fields = ["label": agent.label, "outcome": String(describing: outcome),
                      "status": TrayServer.statusName(svc.status)]
        if outcome.succeeded {
            TrayLog.info("agent re-registered", fields)
        } else {
            TrayLog.warn("agent re-register failed", fields)
        }
        return outcome.succeeded
    }

    static func registration(_ status: SMAppService.Status) -> AgentRegistration {
        switch status {
        case .enabled: return .enabled
        case .notRegistered: return .notRegistered
        case .requiresApproval: return .requiresApproval
        case .notFound: return .notFound
        @unknown default: return .notFound
        }
    }

    /// launchd gives a label to whichever job loads first, so a hand-installed
    /// com.mattstack.deck that won it at login keeps the prod helper from ever
    /// running. It has to go before the helper registers, never after.
    /// Only runnable helpers count: retiring a working hand agent for a helper
    /// registerSync will then refuse leaves deck with no supervisor at all.
    private func clearHandDeckLabel(before plists: [String]) async -> HandDeckRetireOutcome? {
        let labels = agents.filter { plists.contains($0.fileName) }.map(\.label)
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        guard let outcome = await handDeckPreflight.clearLabel(forHelpers: labels, home: home, uid: uid,
                                                               runner: runner, fs: .system) else { return nil }
        TrayServer.logHandDeckOutcome(outcome)
        let notice = HandDeckAgent.blockedNotice(for: outcome, home: home, uid: uid, fs: .system)
        await MainActor.run { onHandDeckBlocked?(notice) }
        return outcome
    }

    private func registerSync(plists: [String], handDeck: HandDeckRetireOutcome? = nil) -> [ServiceRegisterResult] {
        plists.map { name in
            guard let plist = scanned.first(where: { $0.fileName == name }) else {
                return ServiceRegisterResult(plist: name, ok: false, status: "notFound", error: "not shipped in this bundle")
            }
            if let missing = ServiceProgramGuard.missingProgramPath(bundleProgram: plist.bundleProgram, bundlePath: bundlePath,
                                                                     exists: { FileManager.default.isExecutableFile(atPath: $0) }) {
                TrayLog.warn("skipping agent register; BundleProgram not in bundle", ["label": plist.label, "program": missing])
                return ServiceRegisterResult(plist: name, ok: false, status: "notFound", error: "BundleProgram missing: \(missing)")
            }
            let svc = service(plist)
            if let handDeck, plist.label == HandDeckAgent.label {
                if handDeck.freedLoadedLabel {
                    // Registered while the hand job held the label, so launchd never
                    // loaded it; a plain register() would answer already-registered.
                    do { try svc.unregister() } catch where svc.status != .notRegistered {
                        TrayLog.error("deck helper resubmit: unregister failed", ["label": plist.label, "err": String(describing: error)])
                        return ServiceRegisterResult(plist: name, ok: false, status: TrayServer.statusName(svc.status),
                                                     error: "resubmit after hand agent bootout failed: \(error)")
                    } catch {}
                }
                if handDeck.labelMayBeHeld, case .failed(let reason, _) = handDeck {
                    // Still registered so the next login can load it, but the
                    // hand job may own the label now, so this is not a success.
                    _ = try? svc.register()
                    return ServiceRegisterResult(plist: name, ok: false, status: TrayServer.statusName(svc.status),
                                                 error: "hand-installed \(HandDeckAgent.label) may still hold the label: \(reason)")
                }
            }
            do {
                try svc.register()
                let s = svc.status
                TrayLog.info("agent registered", ["label": plist.label, "status": TrayServer.statusName(s)])
                return ServiceRegisterResult(plist: name, ok: s != .notFound, status: TrayServer.statusName(s))
            } catch {
                let ns = error as NSError
                // Literal, not the SMAppServiceErrorDomain symbol: that constant
                // needs macOS 15, this package targets macOS 14.
                let already = ns.domain == "SMAppServiceErrorDomain" && ns.code == kSMErrorAlreadyRegistered
                let s = svc.status
                let ok = already && s != .notFound
                if !ok { TrayLog.error("agent register failed", ["label": plist.label, "err": String(describing: error)]) }
                return ServiceRegisterResult(plist: name, ok: ok, status: TrayServer.statusName(s),
                                             error: ok ? nil : String(describing: error))
            }
        }
    }

    func statuses() async -> [ServiceStatusEntry] {
        agents.map { ServiceStatusEntry(label: $0.label, status: TrayServer.statusName(service($0).status)) }
    }

    func register(plists: [String]) async -> [ServiceRegisterResult] {
        let handDeck = await clearHandDeckLabel(before: plists)
        return await MainActor.run { registerSync(plists: plists, handDeck: handDeck) }
    }

    func unregister(plists: [String]) async -> [ServiceRegisterResult] {
        await MainActor.run {
            plists.map { name in
                guard let plist = scanned.first(where: { $0.fileName == name }) else {
                    return ServiceRegisterResult(plist: name, ok: false, status: "notFound", error: "not shipped in this bundle")
                }
                let svc = service(plist)
                do {
                    try svc.unregister()
                    let s = svc.status
                    TrayLog.info("agent unregistered", ["label": plist.label, "status": TrayServer.statusName(s)])
                    return ServiceRegisterResult(plist: name, ok: s == .notRegistered, status: TrayServer.statusName(s))
                } catch {
                    let gone = svc.status == .notRegistered
                    if !gone { TrayLog.error("agent unregister failed", ["label": plist.label, "err": String(describing: error)]) }
                    return ServiceRegisterResult(plist: name, ok: gone, status: TrayServer.statusName(svc.status),
                                                 error: gone ? nil : String(describing: error))
                }
            }
        }
    }

    func restart(label: String) async -> Bool {
        let (exe, args) = Kickstart.arguments(label: label, uid: uid)
        let out = await runner.run(exe, args)
        if !out.ok { TrayLog.warn("kickstart failed", ["label": label, "stderr": out.stderr]) }
        return out.ok
    }

    func start(label: String) async -> Bool {
        let (exe, args) = StartJob.arguments(label: label, uid: uid)
        let out = await runner.run(exe, args)
        if !out.ok {
            TrayLog.warn("start after register failed", ["label": label, "exit": Int(out.exitCode), "stderr": out.stderr])
        }
        return out.ok
    }

    func waitForJobToLeave(label: String) async -> AgentDrainOutcome {
        let started = ProcessInfo.processInfo.systemUptime
        let outcome = await AgentDrain.wait(lookup: { await self.launchdLookup(label: label) },
                                            now: { ProcessInfo.processInfo.systemUptime },
                                            sleep: { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) })
        let fields: [String: Any] = ["label": label, "outcome": String(describing: outcome),
                                     "seconds": Int(ProcessInfo.processInfo.systemUptime - started)]
        if outcome == .drained {
            TrayLog.info("launchd dropped the unregistered job", fields)
        } else {
            TrayLog.warn("unregistered job did not leave launchd; registering anyway", fields)
        }
        return outcome
    }

    /// On a version change, an agent launchd did not bootstrap this launch
    /// may still run the old bundle's inode, so it is kickstarted with -k.
    /// Recording the new version waits for the agents to answer
    /// (`recordAfterSettle`); an unchanged or first-launch version is
    /// recorded here.
    func handleVersionChange(current: String, store: KeyValueStore,
                             registeredThisLaunch: Set<String>) async -> VersionChangeProgress {
        let change = VersionChangeDetector.evaluate(current: current, store: store)
        guard case .changed(let from, let to) = change else {
            VersionChangeDetector.record(current: current, store: store)
            return VersionChangeProgress(change: change, failedRegisters: [], failedKickstarts: [])
        }
        let labels = LaunchRecording.kickstartLabels(agents.map(\.label), registeredThisLaunch: registeredThisLaunch)
        TrayLog.info("app version changed; restarting agents",
                     ["from": from, "to": to, "kickstart": labels.joined(separator: ","),
                      "bootstrappedThisLaunch": registeredThisLaunch.sorted().joined(separator: ",")])
        let failedRegisters = await registerAll().filter { !$0.ok }.map(\.plist)
        var failedKickstarts: [String] = []
        for label in labels {
            if !(await restart(label: label)) { failedKickstarts.append(label) }
        }
        return VersionChangeProgress(change: change, failedRegisters: failedRegisters,
                                     failedKickstarts: failedKickstarts)
    }

    /// Only the daemon and the deck helper can be heard answering; any other
    /// agent is neither waited on nor healed.
    func launchProbes(daemonLabel: String, daemonAnswers: @escaping @Sendable () async -> Bool,
                      healAgent: @escaping @Sendable (String) async -> Bool) -> [LaunchAgentProbe] {
        agents.compactMap { agent -> LaunchAgentProbe? in
            let answers: @Sendable () async -> Bool
            let budget: AnswerBudget
            switch AgentRole.of(agent, daemonLabel: daemonLabel) {
            case .daemon:
                answers = daemonAnswers
                budget = .daemon
            case .deck:
                answers = { await self.deckAnswers() }
                budget = .deck
            case .other:
                return nil
            }
            let label = agent.label
            return LaunchAgentProbe(label: label, budget: budget, answers: answers,
                                    registration: { Self.registration(self.service(agent).status) },
                                    lookup: { await self.launchdLookup(label: label) },
                                    heal: { await healAgent(label) })
        }
    }

    private func deckAnswers() async -> Bool {
        let (exe, args) = DeckProbe.arguments(deckPath: bundlePath + "/Contents/Helpers/deck")
        return await probeRunner.run(exe, args).ok
    }

    func deckLabel(daemonLabel: String) -> String? {
        agents.first { AgentRole.of($0, daemonLabel: daemonLabel) == .deck }?.label
    }

    /// Runs on the long runner, not the probe runner: deck's managed restart
    /// takes around 10s, and a timeout SIGKILLs it partway through. The
    /// outcome is only logged, never recorded.
    func restartServedApps() async {
        let (exe, args) = DeckRestart.arguments(deckPath: bundlePath + "/Contents/Helpers/deck")
        let outcome = await runner.run(exe, args)
        if outcome.ok {
            TrayLog.info("served apps restarted after version change")
        } else {
            TrayLog.warn("served apps restart after version change failed",
                         ["exit": Int(outcome.exitCode), "stderr": outcome.stderr])
        }
    }

    private func launchdLookup(label: String) async -> LaunchdJobLookup {
        let (exe, args) = LaunchdPrint.arguments(label: label, uid: uid)
        return LaunchdPrint.parse(await runner.run(exe, args))
    }

    func reregisterAgent(label: String) async -> Bool {
        guard let agent = agents.first(where: { $0.label == label }) else { return false }
        return await reregister(agent)
    }

    func settleLaunch(_ probes: [LaunchAgentProbe], latch: SpawnHealLatch) async -> LaunchSettleReport {
        await LaunchSettle.run(probes, latch: latch, now: { ProcessInfo.processInfo.systemUptime },
                               sleep: { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }) { event in
            switch event {
            case .answered(let label):
                TrayLog.info("agent answered after launch", ["label": label])
            case .left(let label, let reason):
                TrayLog.warn("agent not answering after launch; no spawn heal", ["label": label, "reason": reason])
            case .healed(let label, let reason, let reregistered, let answered):
                let fields: [String: Any] = ["label": label, "reason": reason,
                                             "reregistered": reregistered, "answered": answered]
                if answered {
                    TrayLog.info("spawn heal brought the agent back", fields)
                } else {
                    TrayLog.warn("spawn heal did not bring the agent back", fields)
                }
            }
        }
    }

    func recordAfterSettle(_ plan: LaunchRecordPlan, progress: VersionChangeProgress,
                           current: String, store: KeyValueStore) {
        for (label, hash) in plan.hashes {
            store.set(hash, forKey: AgentPlistRefresh.storeKey(label: label))
        }
        if !plan.heldHashes.isEmpty {
            TrayLog.warn("agent plist change applied but agent did not answer; retrying next launch",
                         ["labels": plan.heldHashes.joined(separator: ",")])
        }
        guard case .changed(let from, let to) = progress.change else { return }
        if plan.recordVersion {
            VersionChangeDetector.record(current: current, store: store)
            TrayLog.info("app version recorded after agents answered", ["from": from, "to": to])
        } else {
            TrayLog.warn("version-change restart incomplete; leaving version unrecorded for retry",
                         ["from": from, "to": to, "failedRegisters": progress.failedRegisters,
                          "failedKickstarts": progress.failedKickstarts])
        }
    }
}

extension UserDefaults: KeyValueStore {
    public func set(_ value: String?, forKey key: String) { self.set(value as Any?, forKey: key) }
}
