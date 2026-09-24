import Foundation

public enum DeckRunChoice: Equatable {
    case source(bun: String, entry: String)
    case pinned(reason: String)
}

/// The file system and trust test arrive as closures so the choice is
/// testable without a real home directory.
public struct DeckShimEnvironment {
    let home: String
    let registryTrusted: (String) -> Bool
    let readFile: (String) -> Data?
    let fileExists: (String) -> Bool
    let isExecutable: (String) -> Bool

    public init(home: String,
                registryTrusted: @escaping (String) -> Bool,
                readFile: @escaping (String) -> Data?,
                fileExists: @escaping (String) -> Bool,
                isExecutable: @escaping (String) -> Bool) {
        self.home = home
        self.registryTrusted = registryTrusted
        self.readFile = readFile
        self.fileExists = fileExists
        self.isExecutable = isExecutable
    }
}

private struct Registry: Decodable {
    struct App: Decodable {
        struct Dev: Decodable { let workingDirectory: String? }
        let dev: Dev?
    }
    let apps: [String: App]
}

/// The registry picks the directory deck runs from at every launch, so it is
/// only trusted when this user owns it and nobody else can write it.
public func chooseDeckRun(_ env: DeckShimEnvironment) -> DeckRunChoice {
    let registryPath = "\(env.home)/.mattstack/deck/registry.json"
    guard env.registryTrusted(registryPath) else {
        return .pinned(reason: "registry \(registryPath) is missing or not trusted")
    }
    guard let data = env.readFile(registryPath),
          let registry = try? JSONDecoder().decode(Registry.self, from: data) else {
        return .pinned(reason: "registry \(registryPath) is unreadable")
    }
    guard let dir = registry.apps["deck"]?.dev?.workingDirectory, dir.hasPrefix("/") else {
        return .pinned(reason: "no absolute deck dev.workingDirectory in the registry")
    }
    let entry = "\(dir)/src/main.ts"
    guard env.fileExists(entry) else {
        return .pinned(reason: "deck source not found at \(entry)")
    }
    let bun = "\(env.home)/.bun/bin/bun"
    guard env.fileExists(bun), env.isExecutable(bun) else {
        return .pinned(reason: "bun not found or not executable at \(bun)")
    }
    return .source(bun: bun, entry: entry)
}

public func bundleRoot(fromExecutable path: String) -> String? {
    guard path.hasPrefix("/") else { return nil }
    let url = URL(fileURLWithPath: path)
    let helpers = url.deletingLastPathComponent()
    let contents = helpers.deletingLastPathComponent()
    let app = contents.deletingLastPathComponent()
    guard helpers.lastPathComponent == "Helpers",
          contents.lastPathComponent == "Contents",
          app.pathExtension == "app" else { return nil }
    return app.path
}

public func deckExec(choice: DeckRunChoice, bundleRoot: String,
                     args: [String]) -> (path: String, argv: [String], env: [String: String]) {
    switch choice {
    case .source(let bun, let entry):
        return (bun, [bun, entry] + args,
                ["DECK_BUNDLE_ROOT": bundleRoot, "DECK_RUN_MODE": "source"])
    case .pinned(let reason):
        let pinned = "\(bundleRoot)/Contents/Helpers/deck-pinned"
        return (pinned, [pinned] + args,
                ["DECK_BUNDLE_ROOT": bundleRoot, "DECK_RUN_MODE": "pinned",
                 "DECK_RUN_REASON": reason])
    }
}
