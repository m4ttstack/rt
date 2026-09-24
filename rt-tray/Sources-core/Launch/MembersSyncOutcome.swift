import Foundation

/// What `rt team members sync --json` says about one handle. The verb exits
/// 0 even when a handle stays pending (its reply would not decrypt, echoed a
/// key that is already a recipient, or its record is gone), and `added`
/// lists age keys (the owner's bootstrap key among them), so only
/// `addedHandles` can back an "Added <handle>" banner.
public enum MembersSyncOutcome: Equatable, Sendable {
    /// The sync ran and this handle's reply was added.
    case added
    /// The sync ran but this handle's reply could not be used; the invite stays in place.
    case pending
    /// The sync ran and named this handle in neither list: its invite record is gone.
    case notFound
    /// The output was not the verb's envelope.
    case unknown

    private struct Envelope: Decodable {
        let addedHandles: [String]
        let pending: [String]
    }

    public static func parse(stdout: Data, handle: String) -> MembersSyncOutcome {
        guard let env = try? JSONDecoder().decode(Envelope.self, from: stdout) else { return .unknown }
        if env.addedHandles.contains(handle) { return .added }
        if env.pending.contains(handle) { return .pending }
        return .notFound
    }
}
