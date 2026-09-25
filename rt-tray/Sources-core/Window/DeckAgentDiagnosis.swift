import Foundation

public enum DeckAgentDiagnosis {
    /// Mirrors scripts/render-launchagents.sh, whose DECK_LABEL is the
    /// daemon's label with `daemon` swapped for `deck` in both flavors.
    public static func label(forDaemonLabel daemonLabel: String) -> String {
        guard let range = daemonLabel.range(of: "daemon") else { return daemonLabel }
        return daemonLabel.replacingCharacters(in: range, with: "deck")
    }

    /// `lookup` is nil when launchd was not asked; only an enabled agent is.
    public static func describe(label: String, registration: AgentRegistration,
                                lookup: LaunchdJobLookup?) -> String {
        let agent = "The deck agent (\(label))"
        switch registration {
        case .notRegistered: return "\(agent) is not registered."
        case .requiresApproval: return "\(agent) is waiting for approval in System Settings > General > Login Items."
        case .notFound: return "This app has no deck agent (\(label)) to start."
        case .enabled: break
        }
        guard let lookup else { return "\(agent) is registered." }
        switch lookup {
        case .notLoaded:
            return "\(agent) is registered but launchd has not loaded it."
        case .unknown(let reason):
            return "\(agent) is registered; launchd print failed (\(reason))."
        case .loaded(let job):
            if job.state == "running" {
                return job.pid.map { "\(agent) is running (pid \($0))." } ?? "\(agent) is running."
            }
            var detail = "launchd state: \(job.state ?? "unknown")"
            if let exit = job.lastExitCode { detail += "; last exit code \(exit)" }
            return "\(agent) is not running (\(detail))."
        }
    }
}
