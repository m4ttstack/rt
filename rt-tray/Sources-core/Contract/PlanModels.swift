import Foundation

public enum TeamMode: String, Codable, Equatable, Sendable {
    case join, create, restore
    case noTeam = "none"
}

public struct TeamInfo: Codable, Equatable, Sendable {
    public var slug: String?
    public var name: String?
    public var mode: TeamMode
    public init(slug: String? = nil, name: String? = nil, mode: TeamMode) {
        self.slug = slug; self.name = name; self.mode = mode
    }
}

/// Unknown values decode as `.info` so one new kind from a newer rt
/// cannot blank the whole checklist.
public enum RowKind: String, Codable, Equatable, Sendable {
    case permission, tool, account, access, info

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RowKind(rawValue: raw) ?? .info
    }
}

/// Unknown values decode as `.error` so one new status from a newer rt
/// cannot blank the whole checklist.
public enum RowStatus: String, Codable, Equatable, Sendable {
    case ready, missing, invalid, checking, skipped, error
    case needsYou = "needs-you"

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RowStatus(rawValue: raw) ?? .error
    }
}

public enum RecheckPolicy: String, Codable, Equatable, Sendable {
    case onActivate = "on-activate"
    case onChange = "on-change"
    case manual
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RecheckPolicy(rawValue: raw) ?? .manual
    }
}

public enum ActionType: String, Codable, Equatable, Sendable {
    case openSettings = "open-settings"
    case requestPermission = "request-permission"
    case connect, oauth, install, steps, run
    case ownerOnce = "owner-once"
    case linkBundled = "link-bundled"
    case openURL = "open-url"
    case unknown
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ActionType(rawValue: raw) ?? .unknown
    }
}

public struct ActionField: Codable, Equatable, Sendable {
    public var name: String
    public var label: String
    public var secret: Bool
    public var hint: String?
    public init(name: String, label: String, secret: Bool, hint: String? = nil) {
        self.name = name; self.label = label; self.secret = secret; self.hint = hint
    }
    /// The contract marks secrecy explicitly, so an absent `secret` means "not
    /// secret" — and it degrades this one field rather than failing the decode,
    /// which on a newer rt that stopped emitting the key would blank the whole
    /// checklist.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        label = try c.decode(String.self, forKey: .label)
        secret = try c.decodeIfPresent(Bool.self, forKey: .secret) ?? false
        hint = try c.decodeIfPresent(String.self, forKey: .hint)
    }
}

public struct ActionAlternative: Codable, Equatable, Sendable {
    public var id: String
    public var label: String
    public init(id: String, label: String) { self.id = id; self.label = label }
}

/// One shape for every contract action; which optionals are present is
/// discriminated by `type`. Kept flat so rt can add a field without a
/// decoder change here.
public struct RowAction: Codable, Equatable, Sendable {
    public var type: ActionType
    public var label: String
    public var target: String?
    public var which: String?
    public var integration: String?
    public var fields: [ActionField]?
    public var alternatives: [ActionAlternative]?
    public var verb: [String]?
    public var tool: String?
    public var via: String?
    public var steps: [String]?
    public var url: String?
    public init(type: ActionType, label: String, target: String? = nil, which: String? = nil,
                integration: String? = nil, fields: [ActionField]? = nil,
                alternatives: [ActionAlternative]? = nil, verb: [String]? = nil, tool: String? = nil,
                via: String? = nil, steps: [String]? = nil, url: String? = nil) {
        self.type = type; self.label = label; self.target = target; self.which = which
        self.integration = integration; self.fields = fields; self.alternatives = alternatives
        self.verb = verb; self.tool = tool; self.via = via; self.steps = steps; self.url = url
    }
}

public struct PlanRow: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var kind: RowKind
    public var title: String
    public var why: String
    public var required: Bool
    public var optionalNote: String?
    public var status: RowStatus
    public var detail: String?
    public var action: RowAction?
    public var recheck: RecheckPolicy
    /// Blocks the wizard's Finish (never Install) until ready, skipped, or
    /// waived on this Mac.
    public var finishGated: Bool
    public init(id: String, kind: RowKind, title: String, why: String, required: Bool,
                optionalNote: String? = nil, status: RowStatus, detail: String? = nil,
                action: RowAction? = nil, recheck: RecheckPolicy, finishGated: Bool = false) {
        self.id = id; self.kind = kind; self.title = title; self.why = why; self.required = required
        self.optionalNote = optionalNote; self.status = status; self.detail = detail
        self.action = action; self.recheck = recheck; self.finishGated = finishGated
    }
    /// `finishGated` is newer than the rest of the contract: an rt that
    /// predates it omits the key, and that must read as "not gated" rather
    /// than fail the whole plan.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(RowKind.self, forKey: .kind)
        title = try c.decode(String.self, forKey: .title)
        why = try c.decode(String.self, forKey: .why)
        required = try c.decode(Bool.self, forKey: .required)
        optionalNote = try c.decodeIfPresent(String.self, forKey: .optionalNote)
        status = try c.decode(RowStatus.self, forKey: .status)
        detail = try c.decodeIfPresent(String.self, forKey: .detail)
        action = try c.decodeIfPresent(RowAction.self, forKey: .action)
        recheck = try c.decode(RecheckPolicy.self, forKey: .recheck)
        finishGated = try c.decodeIfPresent(Bool.self, forKey: .finishGated) ?? false
    }
}

public struct PlanGroup: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var rows: [PlanRow]
    public init(id: String, title: String, rows: [PlanRow]) { self.id = id; self.title = title; self.rows = rows }
}

public struct Plan: Codable, Equatable, Sendable {
    public var contract: Int
    public var at: String
    public var team: TeamInfo
    public var groups: [PlanGroup]
    public var canInstall: Bool
    public var requiredMissing: [String]
    /// Finish-gated rows that are neither ready, skipped, nor waived on this
    /// Mac; the wizard's Finish and the window's close buttons wait on it.
    public var finishBlockedBy: [String]
    public init(contract: Int = 1, at: String, team: TeamInfo, groups: [PlanGroup],
                canInstall: Bool, requiredMissing: [String], finishBlockedBy: [String] = []) {
        self.contract = contract; self.at = at; self.team = team; self.groups = groups
        self.canInstall = canInstall; self.requiredMissing = requiredMissing; self.finishBlockedBy = finishBlockedBy
    }
    /// Same rule as `PlanRow.finishGated`: an older rt omits the key.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        contract = try c.decode(Int.self, forKey: .contract)
        at = try c.decode(String.self, forKey: .at)
        team = try c.decode(TeamInfo.self, forKey: .team)
        groups = try c.decode([PlanGroup].self, forKey: .groups)
        canInstall = try c.decode(Bool.self, forKey: .canInstall)
        requiredMissing = try c.decode([String].self, forKey: .requiredMissing)
        finishBlockedBy = try c.decodeIfPresent([String].self, forKey: .finishBlockedBy) ?? []
    }
}
