import Foundation

/// The contract with flock's URL scheme: which scheme to use, and how to
/// build a focus request.
///
/// Pure, and in core rather than the app target, for the same reason
/// `TerminalResolver` is: the decisions are worth checking and AppKit is not
/// available to a check. `FlockBridge` binds this to the real running-app
/// list.
///
/// flock lives in another repository, so nothing here fails to compile when
/// that side changes. These checks are the only thing pinning the shape.
public enum FlockFocusURL {
    /// Prod first: two installed copies each register their own scheme, and
    /// when both are somehow running the one the user installed wins.
    public static let bundles: [(id: String, scheme: String)] = [
        ("dev.mattstack.Flock", "flock"),
        ("dev.mattstack.Flock.dev", "flock-dev"),
    ]

    /// The scheme for whichever flock is running, or nil when none is, which
    /// is the caller's signal to fall back rather than to launch one.
    public static func scheme(forRunningBundleIDs running: Set<String>) -> String? {
        bundles.first { running.contains($0.id) }?.scheme
    }

    /// `URLComponents` rather than string building: it is what encodes a pane
    /// id containing a character that would otherwise end the value.
    public static func url(paneId: String, scheme: String) -> URL? {
        guard !paneId.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = scheme
        components.host = "focus"
        components.queryItems = [URLQueryItem(name: "pane", value: paneId)]
        return components.url
    }
}
