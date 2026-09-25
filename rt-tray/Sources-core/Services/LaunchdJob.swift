import Foundation

public struct LaunchdJobSnapshot: Equatable, Sendable {
    public var state: String?
    public var jobState: String?
    public var lastExitCode: Int?
    public var pid: Int?
    public var properties: [String]

    public init(state: String? = nil, jobState: String? = nil, lastExitCode: Int? = nil,
                pid: Int? = nil, properties: [String] = []) {
        self.state = state; self.jobState = jobState; self.lastExitCode = lastExitCode
        self.pid = pid; self.properties = properties
    }
}

public enum LaunchdJobLookup: Equatable, Sendable {
    case loaded(LaunchdJobSnapshot)
    case notLoaded
    case unknown(String)
}

/// `launchctl print` output is not an API: a field it stops printing reads
/// as nil, and output with neither `state` nor `job state` reads as unknown,
/// never as a verdict.
public enum LaunchdPrint {
    public static let notFoundExitCode: Int32 = 113

    public static func arguments(label: String, uid: uid_t) -> (String, [String]) {
        ("/bin/launchctl", ["print", "gui/\(uid)/\(label)"])
    }

    public static func parse(_ outcome: CommandOutcome) -> LaunchdJobLookup {
        if outcome.exitCode == notFoundExitCode
            || (outcome.stdout + outcome.stderr).contains("Could not find service") {
            return .notLoaded
        }
        guard outcome.ok else { return .unknown("exit \(outcome.exitCode)") }
        var job = LaunchdJobSnapshot()
        var recognised = false
        for line in outcome.stdout.split(separator: "\n") {
            // Nested blocks (coalitions, environment) repeat keys such as
            // `state` and `pid` one tab deeper.
            guard line.hasPrefix("\t"), !line.hasPrefix("\t\t"),
                  let separator = line.range(of: " = ") else { continue }
            let key = String(line[line.index(after: line.startIndex)..<separator.lowerBound])
            let value = String(line[separator.upperBound...]).trimmingCharacters(in: .whitespaces)
            switch key {
            case "state": job.state = value; recognised = true
            case "job state": job.jobState = value; recognised = true
            case "pid": job.pid = Int(value)
            case "last exit code": job.lastExitCode = leadingInt(value)
            case "properties":
                job.properties = value.components(separatedBy: " | ")
                    .map { $0.trimmingCharacters(in: .whitespaces) }
            default: continue
            }
        }
        return recognised ? .loaded(job) : .unknown("unrecognised print shape")
    }

    private static func leadingInt(_ value: String) -> Int? {
        Int(value.prefix(while: { $0.isASCII && ($0.isNumber || $0 == "-") }))
    }
}
