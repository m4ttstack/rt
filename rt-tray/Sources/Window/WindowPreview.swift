#if DEBUG
import AppKit
import MattstackCore
import SwiftUI

private let crashedDeckPrint = "\tstate = not running\n\tlast exit code = 78: EX_CONFIG\n"

/// `rt-tray --window-preview <waiting|ready|tab-5xx> --port <n>
/// [--appearance dark|light] [--deadline <seconds>] [--capture-dir <dir>]`
///
/// The real window view and model against a scripted deck, for looking at
/// the splash states and the tab failure overlay. A scratch build of the app
/// cannot open a second mattstack window on a Mac another flavor owns, and
/// the real app registers launchd jobs, so this mode boots none of the tray.
/// Apps come from a local server on `--port` answering /ok with a page,
/// /fail with a 502 and /icon.svg with an icon.
@MainActor
enum WindowPreview {
    private static var window: NSWindow!
    private static var model: WindowModel!

    private struct Options {
        var scenario = "waiting"
        var appearance = "dark"
        var port = 18777
        var deadline: TimeInterval = 20
        var captureDir: String?

        init(_ args: [String]) {
            func value(_ flag: String) -> String? {
                guard let i = args.firstIndex(of: flag), args.indices.contains(i + 1) else { return nil }
                return args[i + 1]
            }
            scenario = value("--window-preview") ?? scenario
            appearance = value("--appearance") ?? appearance
            port = value("--port").flatMap { Int($0) } ?? port
            deadline = value("--deadline").flatMap { TimeInterval($0) } ?? deadline
            captureDir = value("--capture-dir")
        }
    }

    private struct ScriptedFetcher: AppListFetching {
        let json: Data
        let deckUp: @Sendable () -> Bool
        func fetchAppsJSON() async throws -> Data {
            guard deckUp() else { throw URLError(.badServerResponse) }
            return json
        }
    }

    static func run(arguments: [String]) -> Never {
        if let refusal = WindowPreviewGate.refusal(bundleIdentifier: Bundle.main.bundleIdentifier,
                                                   home: ProcessInfo.processInfo.environment["HOME"],
                                                   accountHome: accountHome()) {
            FileHandle.standardError.write(Data((refusal + "\n").utf8))
            exit(2)
        }
        let options = Options(arguments)
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        app.appearance = NSAppearance(named: options.appearance == "light" ? .aqua : .darkAqua)
        installMenu()

        let started = ProcessInfo.processInfo.systemUptime
        let readyAfter: TimeInterval = options.scenario == "waiting" ? .infinity : 4
        let deckUp: @Sendable () -> Bool = { ProcessInfo.processInfo.systemUptime - started >= readyAfter }
        let base = "http://127.0.0.1:\(options.port)"
        let rtDir = AppHome.current + "/.mattstack/rt"
        let cachePath = rtDir + "/window-apps-cache.json"
        let json = appsJSON(base: base, failFirst: options.scenario == "tab-5xx")
        try? FileManager.default.createDirectory(atPath: rtDir, withIntermediateDirectories: true)
        // Seeded so the first active tab is a scripted app: an empty catalog
        // falls back to the deck tab, which would load this Mac's real deck.
        try? json.write(to: URL(fileURLWithPath: cachePath))

        model = WindowModel(backends: WindowBackends(
            catalog: AppCatalog(fetcher: ScriptedFetcher(json: json, deckUp: deckUp), cachePath: cachePath),
            deckFaviconURL: base + "/icon.svg",
            deckProbe: { deckUp() ? .healthy(pid: "preview") : .answered(status: 502) },
            diagnoseDeckAgent: {
                DeckAgentDiagnosis.describe(
                    label: "com.mattstack.deck", registration: .enabled,
                    lookup: LaunchdPrint.parse(CommandOutcome(exitCode: 0, stdout: crashedDeckPrint, stderr: "")))
            },
            deckWaitDeadline: options.deadline))

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.contentViewController = NSHostingController(rootView: MattstackWindowView(model: model))
        // Re-applied after the hosting controller collapses the window to its
        // content's fitting size (the trap MattstackWindowController notes).
        window.setContentSize(NSSize(width: 1280, height: 820))
        window.center()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        model.presentSplashIfNeeded()
        Task { await model.ensureCatalogLoaded() }
        Task { if await capture(options) { exit(0) } }
        app.run()
        exit(0)
    }

    /// The passwd entry, never HOME, which is exactly what the gate compares.
    private static func accountHome() -> String {
        guard let entry = getpwuid(getuid()), let dir = entry.pointee.pw_dir else { return NSHomeDirectory() }
        return String(cString: dir)
    }

    private static func appsJSON(base: String, failFirst: Bool) -> Data {
        let ok = #"{"name":"board","displayName":"Board","description":null,"url":"\#(base)/ok","icon":"\#(base)/icon.svg"}"#
        let fail = #"{"name":"chat","displayName":"Chat","description":null,"url":"\#(base)/fail","icon":"\#(base)/icon.svg"}"#
        let apps = failFirst ? [fail, ok] : [ok, fail]
        return Data(#"{"apps":[\#(apps.joined(separator: ","))]}"#.utf8)
    }

    private static func capture(_ options: Options) async -> Bool {
        guard let dir = options.captureDir else { return false }
        func shoot(_ state: String) {
            let path = "\(dir)/\(options.scenario)-\(state)-\(options.appearance).png"
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            process.arguments = ["-x", "-o", "-l", String(window.windowNumber), path]
            try? process.run()
            process.waitUntilExit()
            print("captured \(path) exit \(process.terminationStatus)")
            if process.terminationStatus != 0 { renderInProcess(to: path.replacingOccurrences(of: ".png", with: "-inprocess.png")) }
            fflush(stdout)
        }
        switch options.scenario {
        case "waiting":
            await pause(0.5)
            shoot("splash")
            await pause(SplashTuning.minimumVisibleDuration + 1)
            shoot("spinner")
            await waitFor { if case .unreachable = model.deckWait { return true } else { return false } }
            await pause(0.6)
            shoot("cant-reach")
        default:
            await waitFor { model.deckWait == .ready }
            await pause(3)
            let state = options.scenario == "tab-5xx" ? "failure" : "loaded"
            shoot(state)
            await snapshotActiveTab(to: "\(dir)/\(options.scenario)-\(state)-\(options.appearance)-page.png")
        }
        return true
    }

    /// screencapture needs Screen Recording for whoever launched the preview;
    /// drawing the window's own views needs nothing, but WebKit paints out of
    /// process, so page content is missing from these.
    private static func renderInProcess(to path: String) {
        guard let view = window.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        let written = (try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))) != nil
        print("rendered \(path) in process: \(written ? "ok" : "failed")")
    }

    /// The page WebKit drew in the active tab, which the in-process render
    /// cannot show.
    private static func snapshotActiveTab(to path: String) async {
        guard let web = model.store.existingView(for: model.activeApp) else {
            print("no webview for \(model.activeApp)")
            return
        }
        let image = try? await web.takeSnapshot(configuration: nil)
        let png = image?.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0) }?
            .representation(using: .png, properties: [:])
        let written = (try? png?.write(to: URL(fileURLWithPath: path))) != nil
        print("page \(path) (\(web.url?.absoluteString ?? "no url")): \(written ? "ok" : "failed")")
    }

    private static func pause(_ seconds: TimeInterval) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    private static func waitFor(_ condition: () -> Bool) async {
        var polls = 0
        while !condition(), polls < 1200 {
            await pause(0.1)
            polls += 1
        }
    }

    private static func installMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = main
    }
}
#endif
