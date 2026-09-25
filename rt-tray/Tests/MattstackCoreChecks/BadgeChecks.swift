import Foundation
@testable import MattstackCore

private func app(_ name: String, badge: String?) -> DiscoveryApp {
    DiscoveryApp(name: name, displayName: name, description: nil,
                 url: "https://\(name).mattstack", icon: nil, badge: badge)
}

let badgeChecks: [Check] = [
    Check("a catalog without badge keys decodes with no badges") { c in
        let json = Data(#"{"apps":[{"name":"board","displayName":"Board","description":null,"url":"https://board.mattstack","icon":null}]}"#.utf8)
        let apps = try AppCatalog.decode(json)
        try c.requireEqual(apps.map(\.badge), [nil])
    },
    Check("a catalog badge key decodes") { c in
        let json = Data(#"{"apps":[{"name":"board","displayName":"Board","url":"https://board.mattstack","icon":null,"badge":"/api/badge"}]}"#.utf8)
        try c.requireEqual(try AppCatalog.decode(json).first?.badge, "/api/badge")
    },
    Check("endpoint joins a relative badge path onto the app url") { c in
        try c.requireEqual(BadgeParse.endpoint(for: app("board", badge: "/api/badge"))?.absoluteString,
                           "https://board.mattstack/api/badge")
    },
    Check("endpoint refuses absolute, protocol-relative, and missing badge paths") { c in
        c.expect(BadgeParse.endpoint(for: app("board", badge: "https://evil.example/x")) == nil)
        c.expect(BadgeParse.endpoint(for: app("board", badge: "//evil.example/x")) == nil)
        c.expect(BadgeParse.endpoint(for: app("board", badge: nil)) == nil)
    },
    Check("parse reads count and path") { c in
        try c.requireEqual(BadgeParse.parse(Data(#"{"count":3,"path":"/?gate=g1"}"#.utf8)),
                           BadgeReading(count: 3, path: "/?gate=g1"))
        try c.requireEqual(BadgeParse.parse(Data(#"{"count":0}"#.utf8)), BadgeReading(count: 0, path: nil))
    },
    Check("parse rejects negative, fractional, missing counts and bad paths") { c in
        c.expect(BadgeParse.parse(Data(#"{"count":-1}"#.utf8)) == nil)
        c.expect(BadgeParse.parse(Data(#"{"count":1.5}"#.utf8)) == nil)
        c.expect(BadgeParse.parse(Data(#"{}"#.utf8)) == nil)
        c.expect(BadgeParse.parse(Data("nope".utf8)) == nil)
        try c.requireEqual(BadgeParse.parse(Data(#"{"count":1,"path":"https://evil.example"}"#.utf8)),
                           BadgeReading(count: 1, path: nil))
    },
    Check("a count survives two failed fetches and drops on the third") { c in
        var book = BadgeBook()
        book.record(app: "board", reading: BadgeReading(count: 2, path: nil))
        book.record(app: "board", reading: nil)
        book.record(app: "board", reading: nil)
        try c.requireEqual(book.readings["board"]?.count, 2)
        book.record(app: "board", reading: nil)
        c.expect(book.readings["board"] == nil)
    },
    Check("a success resets the failure run") { c in
        var book = BadgeBook()
        book.record(app: "board", reading: BadgeReading(count: 1, path: nil))
        book.record(app: "board", reading: nil)
        book.record(app: "board", reading: nil)
        book.record(app: "board", reading: BadgeReading(count: 4, path: nil))
        book.record(app: "board", reading: nil)
        book.record(app: "board", reading: nil)
        try c.requireEqual(book.readings["board"]?.count, 4)
    },
    Check("retain drops apps that no longer declare a badge") { c in
        var book = BadgeBook()
        book.record(app: "board", reading: BadgeReading(count: 1, path: nil))
        book.record(app: "console", reading: BadgeReading(count: 2, path: nil))
        book.retain(apps: ["console"])
        try c.requireEqual(book.total, 2)
    },
    Check("a reading carries the gate ids its app counted") { c in
        try c.requireEqual(BadgeParse.parse(Data(#"{"count":2,"path":"/?gate=a","ids":["a","b"]}"#.utf8)),
                           BadgeReading(count: 2, path: "/?gate=a", ids: ["a", "b"]))
        try c.requireEqual(BadgeParse.parse(Data(#"{"count":1}"#.utf8))?.ids, [])
    },
    Check("the dock counts a gate two apps both badge once") { c in
        var book = BadgeBook()
        book.record(app: "board", reading: BadgeReading(count: 2, path: nil, ids: ["run-gate", "mr-gate"]))
        book.record(app: "console", reading: BadgeReading(count: 1, path: nil, ids: ["run-gate"]))
        try c.requireEqual(book.readings["board"]?.count, 2)
        try c.requireEqual(book.readings["console"]?.count, 1)
        try c.requireEqual(book.total, 2)
    },
    Check("a reading without ids still adds its count to the dock") { c in
        var book = BadgeBook()
        book.record(app: "board", reading: BadgeReading(count: 1, path: nil, ids: ["g1"]))
        book.record(app: "console", reading: BadgeReading(count: 1, path: nil, ids: ["g1"]))
        book.record(app: "other", reading: BadgeReading(count: 3, path: nil))
        try c.requireEqual(book.total, 4)
    },
    Check("label hides zero and caps at 99+") { c in
        c.expect(BadgeBook.label(0) == nil)
        try c.requireEqual(BadgeBook.label(7), "7")
        try c.requireEqual(BadgeBook.label(99), "99")
        try c.requireEqual(BadgeBook.label(100), "99+")
    },
    Check("firstBadged follows tab order and skips zero counts") { c in
        let readings = ["console": BadgeReading(count: 1, path: "/runs/acme/r2"),
                        "board": BadgeReading(count: 0, path: nil)]
        try c.requireEqual(BadgeBook.firstBadged(readings, order: ["board", "console"]),
                           OpenRequest(app: "console", pathAndQuery: "/runs/acme/r2"))
        c.expect(BadgeBook.firstBadged(["board": BadgeReading(count: 0, path: nil)], order: ["board"]) == nil)
    },
    Check("firstBadged with no path selects the tab without navigating") { c in
        try c.requireEqual(BadgeBook.firstBadged(["board": BadgeReading(count: 2, path: nil)], order: ["board"]),
                           OpenRequest(app: "board", pathAndQuery: ""))
    },
]
