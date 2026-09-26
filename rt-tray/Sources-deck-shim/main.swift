// deck-dev-shim: the dev bundle's Contents/Helpers/deck. It runs deck from
// its registered source checkout under bun when it can, and the pinned
// release (Contents/Helpers/deck-pinned) otherwise. The dev flavor only;
// the prod bundle ships the pinned binary under this name.
//
// Contract with deck: DECK_BUNDLE_ROOT, DECK_RUN_MODE, DECK_RUN_REASON.
// Signed as com.mattstack.helper.deck, the identifier the deck LaunchAgent's
// BundleProgram has always run, so launchd and TCC see the same helper.

import Darwin
import DeckShimLogic
import Foundation

private func log(_ msg: String) {
    FileHandle.standardError.write(Data("deck-dev-shim: \(msg)\n".utf8))
}

private func ownExecutablePath() -> String? {
    var size: UInt32 = 0
    _ = _NSGetExecutablePath(nil, &size)
    var buf = [CChar](repeating: 0, count: Int(size))
    guard _NSGetExecutablePath(&buf, &size) == 0 else { return nil }
    guard let real = realpath(buf, nil) else { return nil }
    defer { free(real) }
    return String(cString: real)
}

private func isTrusted(_ path: String) -> Bool {
    var st = stat()
    guard stat(path, &st) == 0 else { return false }
    guard st.st_uid == getuid() else { return false }
    return (st.st_mode & (mode_t(S_IWGRP) | mode_t(S_IWOTH))) == 0
}

let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
let args = Array(CommandLine.arguments.dropFirst())
let serving = args.first == "serve"

// The deck LaunchAgent sets no StandardErrorPath, so without this the serve
// line would go to /dev/null.
if serving {
    let logsDir = "\(home)/.mattstack/deck/logs"
    try? FileManager.default.createDirectory(atPath: logsDir, withIntermediateDirectories: true)
    _ = freopen("\(logsDir)/deck.err.log", "a", stderr)
}

guard let exe = ownExecutablePath(), let root = bundleRoot(fromExecutable: exe) else {
    log("cannot locate the app bundle from the shim's own path")
    exit(1)
}

let fm = FileManager.default
let choice = chooseDeckRun(DeckShimEnvironment(
    home: home,
    registryTrusted: isTrusted,
    readFile: { fm.contents(atPath: $0) },
    fileExists: { fm.fileExists(atPath: $0) },
    isExecutable: { fm.isExecutableFile(atPath: $0) }
))

if serving {
    switch choice {
    case .source: log("source")
    case .pinned(let reason): log("pinned: \(reason)")
    }
}

let run = deckExec(choice: choice, bundleRoot: root, args: args)
// The source choice never sets DECK_RUN_REASON (only pinned carries a
// reason); unset it so a value inherited from this process's own
// environment does not ride along into a source-run deck.
if case .source = choice { unsetenv("DECK_RUN_REASON") }
for (key, value) in run.env { setenv(key, value, 1) }
var cArgs: [UnsafeMutablePointer<CChar>?] = run.argv.map { strdup($0) }
cArgs.append(nil)
execv(run.path, &cArgs)
log("execv(\(run.path)) failed: \(String(cString: strerror(errno)))")
exit(1)
