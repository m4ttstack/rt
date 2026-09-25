import Foundation
import MattstackCore
import ServiceManagement

/// Everything the window reads from outside the process, so the preview
/// harness can script deck with no network and no launchd job.
struct WindowBackends {
    var catalog: AppCatalog
    var deckFaviconURL: String
    var deckProbe: @Sendable () async -> DeckProbeResult
    var diagnoseDeckAgent: @Sendable () async -> String
    var deckWaitDeadline: TimeInterval

    static func live() -> WindowBackends {
        WindowBackends(
            catalog: AppCatalog(fetcher: URLSessionAppListFetcher(),
                                cachePath: AppHome.current + "/.mattstack/rt/window-apps-cache.json"),
            deckFaviconURL: "https://deck.mattstack/favicon.svg",
            deckProbe: { await LiveDeckProbe.probe() },
            diagnoseDeckAgent: { await LiveDeckDiagnosis.describe() },
            deckWaitDeadline: DeckWaitTuning.deadline)
    }
}

enum LiveDeckProbe {
    static func probe() async -> DeckProbeResult {
        var request = URLRequest(url: URL(string: DeckHealth.url)!, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: DeckWaitTuning.probeTimeout)
        request.httpMethod = "GET"
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .unreachable("no HTTP response") }
            return DeckHealth.classify(status: http.statusCode, deckPid: http.value(forHTTPHeaderField: "x-deck-pid"))
        } catch {
            return .unreachable(error.localizedDescription)
        }
    }
}

/// Read only: asks SMAppService for the agent's status and launchd for its
/// job, and never registers, starts or stops anything.
enum LiveDeckDiagnosis {
    static func describe() async -> String {
        let label = DeckAgentDiagnosis.label(forDaemonLabel: BundleFlavor.daemonLabel)
        let registration = ServicesRegistrar.registration(SMAppService.agent(plistName: label + ".plist").status)
        guard registration == .enabled else {
            return DeckAgentDiagnosis.describe(label: label, registration: registration, lookup: nil)
        }
        let (exe, args) = LaunchdPrint.arguments(label: label, uid: getuid())
        let printed = await SystemCommandRunner(timeout: 5).run(exe, args)
        return DeckAgentDiagnosis.describe(label: label, registration: registration,
                                           lookup: LaunchdPrint.parse(printed))
    }
}
