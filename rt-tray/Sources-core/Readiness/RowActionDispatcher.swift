import Foundation

public enum DispatchedAction: Equatable, Sendable {
    case openSettings(target: String)
    case requestPermission(which: String)
    case rtVerb(args: [String], stdin: Data?)
    case openURL(URL)
    case showSteps([String])
    case chooseFolder(startAt: String?)
    case collectFields([ActionField], integration: String, alternatives: [ActionAlternative], create: ActionLink?)
    case chooseOption(options: [ChooseOption], other: ChooseOther?)
    case none
}

/// Maps a contract action to what the app does. Native for the two
/// permission kinds; everything else is an rt verb, with any collected
/// values on stdin as JSON (sorted keys so the payload is deterministic).
public enum RowActionDispatcher {
    /// The sheet hands a create link straight to the browser, so anything but https is dropped here rather than trusted there.
    static func httpsOnly(_ link: ActionLink?) -> ActionLink? {
        guard let link, let url = URL(string: link.url), url.scheme?.lowercased() == "https", url.host != nil else { return nil }
        return link
    }

    public static func dispatch(_ action: RowAction, fieldValues: [String: String]?, alternative: String?) -> DispatchedAction {
        switch action.type {
        case .openSettings: return .openSettings(target: action.target ?? "")
        case .requestPermission: return .requestPermission(which: action.which ?? "")
        case .connect:
            guard let integration = action.integration else { return .none }
            if alternative == "use-gh" { return .rtVerb(args: ["setup", integration, "connect", "--json"], stdin: json(["useGh": true])) }
            if let values = fieldValues { return .rtVerb(args: ["setup", integration, "connect", "--json"], stdin: json(values)) }
            return .collectFields(action.fields ?? [], integration: integration, alternatives: action.alternatives ?? [], create: httpsOnly(action.create))
        case .ownerOnce:
            guard let integration = action.integration else { return .none }
            if let values = fieldValues { return .rtVerb(args: ["setup", integration, "create-app", "--json"], stdin: json(values)) }
            return .collectFields(action.fields ?? [], integration: integration, alternatives: [], create: nil)
        case .form:
            guard let verb = action.verb, !verb.isEmpty else { return .none }
            if let alternative { return .rtVerb(args: verb + ["--json"], stdin: json(["alternative": alternative])) }
            if let values = fieldValues { return .rtVerb(args: verb + ["--json"], stdin: json(values)) }
            return .collectFields(action.fields ?? [], integration: "", alternatives: action.alternatives ?? [], create: nil)
        case .oauth, .run:
            guard let verb = action.verb, !verb.isEmpty else { return .none }
            return .rtVerb(args: verb + ["--json"], stdin: nil)
        case .install:
            guard let tool = action.tool else { return .none }
            return .rtVerb(args: ["tools", "install", tool, "--json"], stdin: nil)
        case .linkBundled:
            guard let tool = action.tool else { return .none }
            return .rtVerb(args: ["deps", "link", tool, "--json"], stdin: nil)
        case .steps: return .showSteps(action.steps ?? [])
        case .openURL:
            guard let s = action.url, let u = URL(string: s), u.scheme?.hasPrefix("http") == true else { return .none }
            return .openURL(u)
        case .chooseFolder:
            if let path = fieldValues?["root"] {
                return .rtVerb(args: ["setup", "repo-root", "set", "--json"], stdin: json(["root": path]))
            }
            return .chooseFolder(startAt: action.startAt)
        case .choose:
            guard let verb = action.verb, !verb.isEmpty else { return .none }
            if let id = fieldValues?["id"] { return .rtVerb(args: verb + [id, "--json"], stdin: nil) }
            return .chooseOption(options: action.options ?? [], other: action.other)
        case .unknown: return .none
        }
    }

    private static func json<T: Encodable>(_ value: T) -> Data? {
        let enc = JSONEncoder(); enc.outputFormatting = [.sortedKeys]
        return try? enc.encode(value)
    }
}
