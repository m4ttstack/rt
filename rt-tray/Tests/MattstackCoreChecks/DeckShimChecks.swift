import Foundation
import DeckShimLogic

private let home = "/Users/t"
private let registry = "/Users/t/.mattstack/deck/registry.json"
private let checkout = "/Users/t/src/apps/deck"
private let bun = "/Users/t/.bun/bin/bun"

private func registryJSON(_ dir: String?) -> Data {
    let dev = dir.map { #"{"workingDirectory":"\#($0)"}"# } ?? "{}"
    return Data(#"{"version":1,"apps":{"deck":{"name":"deck","dev":\#(dev)}}}"#.utf8)
}

private func env(trusted: Bool = true, data: Data? = registryJSON(checkout),
                 files: Set<String> = ["\(checkout)/src/main.ts", bun],
                 executables: Set<String> = [bun]) -> DeckShimEnvironment {
    DeckShimEnvironment(home: home,
                        registryTrusted: { $0 == registry && trusted },
                        readFile: { $0 == registry ? data : nil },
                        fileExists: { files.contains($0) },
                        isExecutable: { executables.contains($0) })
}

private func reason(_ choice: DeckRunChoice) -> String? {
    if case .pinned(let r) = choice { return r }
    return nil
}

let deckShimChecks: [Check] = [
    Check("deck shim runs source when the checkout and bun are present") { c in
        try c.requireEqual(chooseDeckRun(env()),
                           .source(bun: bun, entry: "\(checkout)/src/main.ts"))
    },
    Check("deck shim falls back to pinned on an untrusted registry") { c in
        c.expect(reason(chooseDeckRun(env(trusted: false)))?.contains("registry") == true)
    },
    Check("deck shim falls back to pinned on unreadable or malformed registry") { c in
        c.expect(reason(chooseDeckRun(env(data: nil))) != nil)
        c.expect(reason(chooseDeckRun(env(data: Data("nope".utf8)))) != nil)
    },
    Check("deck shim falls back to pinned with no deck dev.workingDirectory") { c in
        c.expect(reason(chooseDeckRun(env(data: registryJSON(nil))))?.contains("workingDirectory") == true)
    },
    Check("deck shim refuses a relative workingDirectory") { c in
        c.expect(reason(chooseDeckRun(env(data: registryJSON("src/apps/deck")))) != nil)
    },
    Check("deck shim falls back to pinned when src/main.ts is missing") { c in
        c.expect(reason(chooseDeckRun(env(files: [bun])))?.contains("main.ts") == true)
    },
    Check("deck shim falls back to pinned when bun is missing or not executable") { c in
        c.expect(reason(chooseDeckRun(env(files: ["\(checkout)/src/main.ts"], executables: [])))?.contains("bun") == true)
        c.expect(reason(chooseDeckRun(env(executables: [])))?.contains("bun") == true)
    },
    Check("bundle root comes from the shim's own absolute path") { c in
        try c.requireEqual(bundleRoot(fromExecutable: "/Applications/mattstack-dev.app/Contents/Helpers/deck"),
                           "/Applications/mattstack-dev.app")
        c.expect(bundleRoot(fromExecutable: "Contents/Helpers/deck") == nil)
        c.expect(bundleRoot(fromExecutable: "/usr/local/bin/deck") == nil)
    },
    Check("source exec passes args through with the bundle root and mode") { c in
        let run = deckExec(choice: .source(bun: bun, entry: "\(checkout)/src/main.ts"),
                           bundleRoot: "/A.app", args: ["serve"])
        try c.requireEqual(run.path, bun)
        try c.requireEqual(run.argv, [bun, "\(checkout)/src/main.ts", "serve"])
        try c.requireEqual(run.env, ["DECK_BUNDLE_ROOT": "/A.app", "DECK_RUN_MODE": "source"])
    },
    Check("pinned exec runs deck-pinned and carries the reason") { c in
        let run = deckExec(choice: .pinned(reason: "bun missing"), bundleRoot: "/A.app", args: ["--version"])
        try c.requireEqual(run.path, "/A.app/Contents/Helpers/deck-pinned")
        try c.requireEqual(run.argv, ["/A.app/Contents/Helpers/deck-pinned", "--version"])
        try c.requireEqual(run.env, ["DECK_BUNDLE_ROOT": "/A.app", "DECK_RUN_MODE": "pinned",
                                     "DECK_RUN_REASON": "bun missing"])
    },
]
