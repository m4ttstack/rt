import Foundation

/// The checklist's footer line. `canInstall` alone does not mean nothing is
/// owed: a finish-gated, unwaivable row can be unmet while Install is still
/// enabled, and the footer must say so rather than claim everything is ready.
public enum ChecklistFooter {
    public static func text(canInstall: Bool, requiredMissingCount: Int, owedBeforeFinish: [String]) -> String {
        if !canInstall { return requiredMissingCount == 1 ? "1 required item left." : "\(requiredMissingCount) required items left." }
        if owedBeforeFinish.isEmpty { return "Everything required is ready." }
        return "Ready to install. Still needed before you finish: \(owedBeforeFinish.joined(separator: ", "))."
    }

    /// Titles of rows badged `.required` that are neither ready nor skipped, in plan order.
    public static func owedBeforeFinish(_ rows: [PlanRow]) -> [String] {
        rows.filter { $0.badge == .required && $0.status != .ready && $0.status != .skipped }.map(\.title)
    }
}
