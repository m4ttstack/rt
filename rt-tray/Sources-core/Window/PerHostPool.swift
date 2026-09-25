import Foundation

/// One value per URL host, made on first use, so two hosts never share one.
public struct PerHostPool<Value> {
    private var entries: [String: Value] = [:]

    public init() {}

    public static func key(for url: URL) -> String? {
        guard let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        if let port = url.port { return "\(host):\(port)" }
        return host
    }

    public mutating func value(for url: URL, make: () -> Value) -> Value? {
        guard let key = Self.key(for: url) else { return nil }
        if let existing = entries[key] { return existing }
        let made = make()
        entries[key] = made
        return made
    }

    /// Returns the dropped values so the caller can release them.
    public mutating func retain(urls: [URL]) -> [Value] {
        let keep = Set(urls.compactMap(Self.key(for:)))
        let dropped = entries.filter { !keep.contains($0.key) }
        entries = entries.filter { keep.contains($0.key) }
        return Array(dropped.values)
    }
}
