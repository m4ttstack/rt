import Foundation
@testable import MattstackCore

private func url(_ string: String) -> URL { URL(string: string)! }

let perHostPoolChecks: [Check] = [
    Check("pool key is the lowercased host, whatever the path or query") { c in
        try c.requireEqual(PerHostPool<Int>.key(for: url("https://Board.MATTSTACK/api/badge?x=1")), "board.mattstack")
    },
    Check("pool key keeps an explicit port") { c in
        try c.requireEqual(PerHostPool<Int>.key(for: url("https://board.mattstack:8443/api/badge")),
                           "board.mattstack:8443")
    },
    Check("pool key is nil for a URL with no host") { c in
        c.expect(PerHostPool<Int>.key(for: url("/api/badge")) == nil)
        c.expect(PerHostPool<Int>.key(for: URL(fileURLWithPath: "/tmp/badge")) == nil)
    },
    Check("pool makes one value per host and reuses it across paths") { c in
        var pool = PerHostPool<Int>()
        var made = 0
        let make = { () -> Int in made += 1; return made }
        let first = pool.value(for: url("https://board.mattstack/api/badge"), make: make)
        let again = pool.value(for: url("https://board.mattstack/other"), make: make)
        try c.requireEqual(first, 1)
        try c.requireEqual(again, 1)
        try c.requireEqual(made, 1)
    },
    Check("pool never shares a value between two app hosts") { c in
        var pool = PerHostPool<Int>()
        var made = 0
        let make = { () -> Int in made += 1; return made }
        let board = pool.value(for: url("https://board.mattstack/api/badge"), make: make)
        let console = pool.value(for: url("https://console.mattstack/api/badge"), make: make)
        c.expect(board != nil && console != nil && board != console)
    },
    Check("pool refuses a hostless URL without making anything") { c in
        var pool = PerHostPool<Int>()
        var made = 0
        c.expect(pool.value(for: url("/api/badge"), make: { made += 1; return made }) == nil)
        try c.requireEqual(made, 0)
    },
    Check("pool retain hands back the values of hosts no longer targeted and keeps the rest") { c in
        var pool = PerHostPool<Int>()
        var made = 0
        let make = { () -> Int in made += 1; return made }
        _ = pool.value(for: url("https://board.mattstack/api/badge"), make: make)
        _ = pool.value(for: url("https://console.mattstack/api/badge"), make: make)
        let dropped = pool.retain(urls: [url("https://console.mattstack/api/badge")])
        try c.requireEqual(dropped, [1])
        try c.requireEqual(pool.value(for: url("https://console.mattstack/api/badge"), make: make), 2)
        try c.requireEqual(pool.value(for: url("https://board.mattstack/api/badge"), make: make), 3)
    },
]
