import Foundation

public struct BadgeReading: Equatable, Sendable {
    public let count: Int
    public let path: String?
    /// The gates behind `count`, when the app reports them: two apps can
    /// badge the same gate (board and console both count a run's gate).
    public let ids: [String]
    public init(count: Int, path: String?, ids: [String] = []) {
        self.count = count
        self.path = path
        self.ids = ids
    }
}

public enum BadgeParse {
    /// Only a path on the app's own origin is accepted, so a manifest can
    /// never point the tray's fetch or a badge click at another host.
    static func isInAppPath(_ path: String) -> Bool {
        path.hasPrefix("/") && !path.hasPrefix("//")
    }

    public static func endpoint(for app: DiscoveryApp) -> URL? {
        guard let path = app.badge, isInAppPath(path) else { return nil }
        return URL(string: app.url + path)
    }

    private struct Payload: Decodable {
        let count: Int
        let path: String?
        let ids: [String]?
    }

    /// `JSONDecoder` rejects a fractional, boolean, or missing count.
    public static func parse(_ data: Data) -> BadgeReading? {
        guard let payload = try? JSONDecoder().decode(Payload.self, from: data),
              payload.count >= 0 else { return nil }
        return BadgeReading(count: payload.count,
                            path: payload.path.flatMap { isInAppPath($0) ? $0 : nil },
                            ids: payload.ids ?? [])
    }
}

public struct BadgeBook: Sendable {
    /// Matches the tray's daemon-health rule: two misses in a row are noise,
    /// the third means the app is really gone.
    public static let failureHold = 2

    public private(set) var readings: [String: BadgeReading] = [:]
    private var failures: [String: Int] = [:]

    public init() {}

    public mutating func record(app: String, reading: BadgeReading?) {
        if let reading {
            readings[app] = reading
            failures[app] = 0
            return
        }
        let misses = (failures[app] ?? 0) + 1
        failures[app] = misses
        if misses > Self.failureHold { readings[app] = nil }
    }

    public mutating func retain(apps: Set<String>) {
        readings = readings.filter { apps.contains($0.key) }
        failures = failures.filter { apps.contains($0.key) }
    }

    /// Each gate once across apps; a reading without ids adds its count.
    public var total: Int {
        var gates = Set<String>()
        var unkeyed = 0
        for reading in readings.values {
            if reading.ids.isEmpty { unkeyed += reading.count } else { gates.formUnion(reading.ids) }
        }
        return gates.count + unkeyed
    }

    public static func label(_ count: Int) -> String? {
        if count <= 0 { return nil }
        return count > 99 ? "99+" : String(count)
    }

    public static func firstBadged(_ readings: [String: BadgeReading], order: [String]) -> OpenRequest? {
        for name in order {
            guard let reading = readings[name], reading.count > 0 else { continue }
            return OpenRequest(app: name, pathAndQuery: reading.path ?? "")
        }
        return nil
    }
}
