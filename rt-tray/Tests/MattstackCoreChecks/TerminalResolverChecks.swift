import Foundation
import MattstackCore

/// A fake process table: pid -> (parent pid, executable path).
private func lookups(_ procs: [Int: (parent: Int, path: String)])
    -> (parentOf: (Int) -> Int?, pathOf: (Int) -> String?) {
    ({ procs[$0]?.parent }, { procs[$0]?.path })
}

let terminalResolverChecks: [Check] = [
    Check("terminalAppPid finds the terminal app in a shell's ancestry") { c in
        let (parentOf, pathOf) = lookups([
            200: (150, "/bin/zsh"),
            150: (100, "/usr/bin/login"),
            100: (1, "/Applications/Ghostty.app/Contents/MacOS/ghostty"),
        ])
        c.expectEqual(TerminalResolver.terminalAppPid(ancestorOf: 200, parentOf: parentOf, pathOf: pathOf), 100)
    },
    Check("terminalAppPid is nil when the chain tops out at launchd (daemon-hosted pane shell)") { c in
        let (parentOf, pathOf) = lookups([
            300: (250, "/bin/zsh"),
            250: (1, "/Users/x/.local/bin/herdr"),
        ])
        c.expectEqual(TerminalResolver.terminalAppPid(ancestorOf: 300, parentOf: parentOf, pathOf: pathOf), nil)
    },
    Check("herdr-client fallback resolves the terminal hosting an attach client") { c in
        // Pane shell 300 hangs off the launchd-parented herdr server 250; the
        // attach client 400 is the process whose ancestry reaches the terminal.
        let (parentOf, pathOf) = lookups([
            300: (250, "/bin/zsh"),
            250: (1, "/Users/x/.local/bin/herdr"),
            400: (350, "/Users/x/.local/bin/herdr"),
            350: (320, "/bin/zsh"),
            320: (100, "/usr/bin/login"),
            100: (1, "/Applications/Ghostty.app/Contents/MacOS/ghostty"),
        ])
        c.expectEqual(
            TerminalResolver.terminalAppPidViaHerdrClient(
                allPids: [100, 250, 300, 320, 350, 400], parentOf: parentOf, pathOf: pathOf),
            100)
    },
    Check("herdr-client fallback returns nil when only the server exists") { c in
        let (parentOf, pathOf) = lookups([
            300: (250, "/bin/zsh"),
            250: (1, "/Users/x/.local/bin/herdr"),
        ])
        c.expectEqual(
            TerminalResolver.terminalAppPidViaHerdrClient(
                allPids: [250, 300], parentOf: parentOf, pathOf: pathOf),
            nil)
    },
    Check("herdr-client fallback skips non-herdr processes under terminals") { c in
        let (parentOf, pathOf) = lookups([
            500: (320, "/usr/local/bin/vim"),
            320: (100, "/usr/bin/login"),
            100: (1, "/Applications/Ghostty.app/Contents/MacOS/ghostty"),
        ])
        c.expectEqual(
            TerminalResolver.terminalAppPidViaHerdrClient(
                allPids: [100, 320, 500], parentOf: parentOf, pathOf: pathOf),
            nil)
    },
]
