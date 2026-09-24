import Foundation
import ServiceManagement
import MattstackCore

/// FlavorTeardown's steps against this app's own SMAppService registrations.
/// Only an app can unregister what it registered, so both retire paths (the
/// other app's POST /flavor/retire and a login-item stand-down) run here.
struct AppFlavorTeardown: FlavorTeardownSteps {
    let lifecycle: DaemonLifecycle?

    static func run(lifecycle: DaemonLifecycle?) async -> FlavorTeardownResult {
        let result = await FlavorTeardown.run(AppFlavorTeardown(lifecycle: lifecycle))
        if result.retired {
            TrayLog.info("flavor retired", ["reply": result.replyJSON])
        } else {
            TrayLog.error("flavor retire incomplete", ["reply": result.replyJSON])
        }
        return result
    }

    func stopDaemon() async -> String {
        guard let lifecycle else { return "unknown" }
        await lifecycle.stopDaemonForTeardown(origin: DaemonOrigin.flavorRetire)
        return TrayServer.statusName(lifecycle.status)
    }

    func unregisterAgents() async -> [FlavorTeardownAgent] {
        let registrar = ServicesRegistrar(bundlePath: Bundle.main.bundlePath, runner: SystemCommandRunner())
        let results = await registrar.unregister(plists: registrar.agents.map(\.fileName))
        return zip(registrar.agents, results).map { FlavorTeardownAgent(label: $0.label, status: $1.status) }
    }

    func retireHandDeck() async -> String {
        await TrayServer.retireHandDeckAgent().name
    }

    func unregisterLoginItem() async -> (status: String, error: String?) {
        var error: String?
        do {
            try await SMAppService.mainApp.unregister()
        } catch let e {
            // Unregistering an already-unregistered login item throws; the
            // status read after it is the ground truth.
            error = String(describing: e)
        }
        return (TrayServer.statusName(SMAppService.mainApp.status), error)
    }
}
