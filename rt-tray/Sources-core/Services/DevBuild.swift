import Foundation

/// The dev flavor's restart-to-new-build flow: a staged build carries a stamp
/// in its Info.plist, and a detached shell hands the swap off once the running
/// app has exited.
public enum DevBuild {
    public static let stampKey = "MSBuildStamp"
    public static let treeKey = "MSBuildTree"
    public static let shaKey = "MSBuildSha"
    public static let diffHashKey = "MSBuildDiffHash"
    public static let versionKey = "MSBuildVersion"
    public static let cacheKeep = 4
    /// No `.app` extension, so LaunchServices never registers a cached copy
    /// under the dev bundle id. Must match `CACHED_BUNDLE_NAME` in
    /// lib/release/dev-app-cache.ts.
    public static let cachedBundleName = "bundle"

    /// What a bundle was built from. Written by `stageLocalDevApp`
    /// (lib/release/dev-app-cache.ts computes it), which also looks cached
    /// bundles up by it.
    public struct BuildIdentity: Equatable, Sendable {
        public let tree: String
        public let sha: String
        public let diffHash: String
        public let version: String
        public init(tree: String, sha: String, diffHash: String, version: String) {
            self.tree = tree
            self.sha = sha
            self.diffHash = diffHash
            self.version = version
        }
    }

    /// Where the handoff files the outgoing app. Built only from an absolute
    /// `.../builds` dir and a plain child name, because the handoff deletes
    /// recursively inside it.
    public struct CacheTarget: Equatable, Sendable {
        public let buildsDir: String
        public let entryName: String
        public init?(buildsDir: String, entryName: String) {
            let parts = buildsDir.split(separator: "/", omittingEmptySubsequences: true)
            guard buildsDir.hasPrefix("/"), parts.last == "builds", !parts.contains(where: { $0 == ".." || $0 == "." }),
                  !entryName.isEmpty, !entryName.hasPrefix("."), !entryName.contains("/") else { return nil }
            self.buildsDir = buildsDir
            self.entryName = entryName
        }
    }

    public static func identity(atBundle path: String, readFile: (String) -> Data?) -> BuildIdentity? {
        guard let data = readFile("\(path)/Contents/Info.plist"),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let tree = plist[treeKey] as? String, !tree.isEmpty,
              let sha = plist[shaKey] as? String, !sha.isEmpty,
              let diffHash = plist[diffHashKey] as? String, !diffHash.isEmpty,
              let version = plist[versionKey] as? String, !version.isEmpty else { return nil }
        return BuildIdentity(tree: tree, sha: sha, diffHash: diffHash, version: version)
    }

    /// Readable (tree name, short sha) plus a hash of the full identity, so
    /// two trees sharing a name or two dirty states of one commit never share
    /// an entry.
    public static func cacheEntryName(for id: BuildIdentity) -> String {
        let base = (id.tree as NSString).lastPathComponent
        let safe = String(base.map { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") ? $0 : "_" })
        let short = String(id.sha.prefix(12).map { $0.isASCII && ($0.isLetter || $0.isNumber) ? $0 : "_" })
        let digest = fnv1a64("\(id.tree)\n\(id.sha)\n\(id.diffHash)\n\(id.version)")
        return "\(safe.isEmpty ? "tree" : safe)-\(short)-\(String(format: "%016llx", digest))"
    }

    public static func cachedIdentities(buildsDir: String, listDir: (String) -> [String],
                                        readFile: (String) -> Data?) -> [BuildIdentity] {
        listDir(buildsDir).sorted().filter { !$0.hasPrefix(".") }.compactMap {
            identity(atBundle: "\(buildsDir)/\($0)/\(cachedBundleName)", readFile: readFile)
        }
    }

    static func fnv1a64(_ s: String) -> UInt64 {
        var h: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in s.utf8 {
            h ^= UInt64(byte)
            h = h &* 0x0000_0100_0000_01b3
        }
        return h
    }

    /// Read from disk each time: `Bundle.main.infoDictionary` is cached at
    /// launch and never sees a bundle written afterwards.
    public static func stamp(atBundle path: String, readFile: (String) -> Data?) -> String? {
        guard let data = readFile("\(path)/Contents/Info.plist"),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let stamp = plist[stampKey] as? String, !stamp.isEmpty else { return nil }
        return stamp
    }

    /// A staged bundle only exists until a restart moves it, so it is never the
    /// running build; an unstamped running app (built from a pushed ref) still
    /// takes it.
    public static func newerBuildReady(running: String?, staged: String?) -> Bool {
        guard let staged else { return false }
        return running != staged
    }

    /// A /bin/sh script that waits for `pid` to exit (giving up after 30s, so a
    /// cancelled quit never relaunches later), then swaps `stagedPath` into
    /// `appPath` by rename with rollback and reopens the app. Only when the
    /// bundle changed does it restart the deck helper and then deck's managed
    /// apps: they run the bundle's Helpers/bun, and a process whose binary was
    /// deleted with the old bundle loses its privacy grants (EPERM reading
    /// ~/Documents). With no staged path it is a plain relaunch. With a
    /// cache target, the outgoing app is filed there after a swap instead of
    /// deleted, and the cache is trimmed to `cacheKeep` entries.
    public static func handoffScript(pid: Int32, appPath: String, stagedPath: String?, deckLabel: String?,
                                     uid: UInt32, logPath: String? = nil,
                                     openPath: String = "/usr/bin/open",
                                     launchctlPath: String = "/bin/launchctl",
                                     deckCLIPath: String? = nil,
                                     cache: CacheTarget? = nil,
                                     statPath: String = "/usr/bin/stat") -> String {
        let app = shellQuote(appPath)
        let aside = shellQuote(appPath + ".restart-old")
        var lines: [String] = []
        // A failed exec redirect kills sh outright, which would leave the app
        // quit and never reopened; probing in a subshell makes logging optional.
        if let logPath {
            let log = shellQuote(logPath)
            lines.append("if ( : >> \(log) ) 2>/dev/null; then exec >> \(log) 2>&1; fi")
        }
        lines += [
            "echo \"handoff $(date '+%F %T') pid \(pid)\"",
            "i=0",
            "while kill -0 \(pid) 2>/dev/null; do i=$((i+1)); [ $i -ge 300 ] && { echo 'app did not exit; nothing changed'; exit 1; }; sleep 0.1; done",
            "swapped=0",
        ]
        if let stagedPath {
            let staged = shellQuote(stagedPath)
            // mv onto an existing directory moves INTO it, so the aside path
            // must be gone before the app is moved there. It is shared by
            // every handoff, so the outgoing app leaves it before the reopen.
            lines += [
                "parked=0",
                "if [ ! -d \(staged) ]; then echo 'no staged build'",
                "else",
                "  rm -rf \(aside)",
                "  if [ -e \(aside) ]; then echo 'stale aside copy could not be removed; not swapping'",
                "  elif mv \(app) \(aside); then",
                "    if mv \(staged) \(app); then swapped=1; echo swapped",
            ]
            let appParent = (appPath as NSString).deletingLastPathComponent
            lines += cache.map { parkLines($0, aside: aside, appParent: appParent, statPath: statPath) }
                ?? ["      rm -rf \(aside)"]
            lines += [
                "    else rm -rf \(app); mv \(aside) \(app); echo 'swap failed; previous app restored'; fi",
                "  fi",
                "fi",
            ]
        }
        lines.append("\(shellQuote(openPath)) \(app)")
        if let deckLabel {
            let deck = shellQuote(deckCLIPath ?? appPath + "/Contents/Helpers/deck")
            lines += [
                "if [ $swapped = 1 ]; then",
                "  \(shellQuote(launchctlPath)) kickstart -k gui/\(uid)/\(deckLabel)",
                // Retry only while deck is not answering: restart --managed
                // also fails when one app fails, and retrying that would
                // re-kill every healthy app each second.
                "  n=0; until \(deck) list --json >/dev/null 2>&1; do n=$((n+1)); [ $n -ge 30 ] && break; sleep 1; done",
                "  \(deck) restart --managed || echo 'restart --managed reported a failure'",
                "fi",
            ]
        }
        // Runs last so filing and trimming the cache never delays the
        // relaunch, and nothing it does can undo the swap.
        if let cache, stagedPath != nil {
            lines += fileLines(cache)
        }
        lines.append("exit 0")
        return lines.joined(separator: "\n")
    }

    private static func incomingPath(_ cache: CacheTarget) -> String {
        shellQuote("\(cache.buildsDir)/.incoming-") + "$$"
    }

    /// Parking is a rename only on the app's own volume; across volumes mv
    /// would copy the whole bundle before the app reopens, so the outgoing
    /// app is deleted instead and that restart caches nothing.
    private static func parkLines(_ cache: CacheTarget, aside: String, appParent: String, statPath: String) -> [String] {
        let builds = shellQuote(cache.buildsDir)
        let incoming = incomingPath(cache)
        let stat = shellQuote(statPath)
        return [
            "      mkdir -p \(builds) 2>/dev/null",
            "      va=$(\(stat) -f %d \(shellQuote(appParent)) 2>/dev/null); vb=$(\(stat) -f %d \(builds) 2>/dev/null)",
            "      if [ -z \"$va\" ] || [ \"$va\" != \"$vb\" ]; then echo 'the build cache is on another volume than the app; not caching the previous build'; rm -rf \(aside)",
            "      elif rm -rf \(incoming) && mkdir \(incoming) && mv \(aside) \(incoming)/\(cachedBundleName); then parked=1",
            "      else echo 'could not cache the previous build; deleting it'; rm -rf \(incoming) \(aside); fi",
        ]
    }

    /// Every recursive delete is re-checked against the builds dir in the
    /// shell as well, so a mangled path can only ever miss, never escape it.
    private static func fileLines(_ cache: CacheTarget) -> [String] {
        let builds = shellQuote(cache.buildsDir)
        let entry = shellQuote("\(cache.buildsDir)/\(cache.entryName)")
        let incoming = incomingPath(cache)
        let inside = "\(builds)/?*"
        return [
            "if [ $parked = 1 ]; then",
            "  cached=0",
            "  date +%s > \(incoming)/cached-at",
            "  case \(entry) in \(inside)) rm -rf \(entry) ;; esac",
            "  if [ ! -e \(entry) ] && mv \(incoming) \(entry); then cached=1; echo \"cached the previous build at \"\(entry); fi",
            "  if [ $cached = 0 ]; then echo 'could not cache the previous build; deleting it'; rm -rf \(incoming); fi",
            "fi",
            "if [ $swapped = 1 ]; then",
            // A handoff killed mid-filing leaves its incoming dir; ten
            // minutes is far past any live handoff's filing step.
            "  find \(builds) -mindepth 1 -maxdepth 1 -type d -name '.incoming-*' ! -name \".incoming-$$\" -mmin +10 | "
                + "while read -r d; do case \"$d\" in \(builds)/.incoming-?*) rm -rf \"$d\"; echo \"swept $d\" ;; esac; done",
            "  for d in \(builds)/*; do [ -d \"$d\" ] || continue; t=$(cat \"$d/cached-at\" 2>/dev/null); "
                + "case $t in ''|*[!0-9]*) t=0 ;; esac; echo \"$t $d\"; done | sort -rn | tail -n +\(cacheKeep + 1) | "
                + "while read -r t d; do case \"$d\" in \(inside)) rm -rf \"$d\"; echo \"evicted $d\" ;; esac; done",
            "fi",
        ]
    }

    static func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
