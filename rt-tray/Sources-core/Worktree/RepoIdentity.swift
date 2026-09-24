import Foundation

/// A decoded serialized repo identity: `remote:<encodeURIComponent(host/path)>`
/// or `path:<encodeURIComponent(/abs/path)>`. Parity with rt-client's
/// `parseIdentity`: only canonical wires decode, so a hand-built string never
/// yields a label that looks like a real repo.
public struct RepoIdentity: Equatable, Sendable {
    public enum Kind: String, Sendable { case remote, path }

    public let kind: Kind
    public let id: String

    /// The `encodeURIComponent` unreserved set.
    private static let unreserved = CharacterSet(charactersIn:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    public init?(wire: String) {
        guard let colon = wire.firstIndex(of: ":"),
              let kind = Kind(rawValue: String(wire[..<colon])) else { return nil }
        let encoded = String(wire[wire.index(after: colon)...])
        guard let id = encoded.removingPercentEncoding,
              id.addingPercentEncoding(withAllowedCharacters: Self.unreserved) == encoded else { return nil }
        self.kind = kind
        self.id = id
    }

    /// Last path segment for remote-kind, basename for path-kind (`repoLabel` in lib/repo-label.ts).
    public var label: String {
        switch kind {
        case .remote: return id.split(separator: "/").last.map(String.init) ?? id
        case .path: return (id as NSString).lastPathComponent
        }
    }

    public var host: String? {
        kind == .remote ? id.split(separator: "/", omittingEmptySubsequences: false).first.map(String.init) : nil
    }

    public var isGitHub: Bool { host == "github.com" }

    /// A string that is not a canonical wire passes through unchanged, as the CLI's `repoLabel` does.
    public static func label(_ wire: String) -> String { RepoIdentity(wire: wire)?.label ?? wire }

    /// "#" before a GitHub PR number, "!" before a GitLab MR number.
    public static func changeMarker(_ wire: String) -> String { RepoIdentity(wire: wire)?.isGitHub == true ? "#" : "!" }

    public static func changeNoun(_ wire: String) -> String { RepoIdentity(wire: wire)?.isGitHub == true ? "PR" : "MR" }
}
