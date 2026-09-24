import AppKit
import Foundation
import MattstackCore
import Network
import ServiceManagement

// MARK: - TrayServer

/// Body of the daemon's POST /pane/focus (its pane:focus verb).
private struct FocusPaneRequest: Decodable { let paneId: String }

/// Small HTTP server on ~/.mattstack/rt/tray.sock that receives push notifications from the daemon.
/// The daemon POSTs to /notify with a NotificationEvent JSON body.
class TrayServer {

    static let shared = TrayServer()

    var onNotification: ((NotificationEvent) -> Void)?
    var daemonLifecycle: DaemonLifecycle?
    var routes: TrayRoutes?

    private var listener: NWListener?
    private let socketPath: String
    private let queue = DispatchQueue(label: "com.rt.tray-server", qos: .userInitiated)

    private init() {
        socketPath = Self.socketPath
    }

    /// The one socket both flavors bind. Static so the startup guard can
    /// probe it before any TrayServer instance exists.
    static let socketPath = AppHome.current + "/.mattstack/rt/tray.sock"

    // MARK: - Startup mutual exclusion

    /// Who holds the socket at launch (`main.swift`, before ANY SMAppService
    /// registration).
    ///
    /// `start()` unlinks and rebinds blindly, so without this the
    /// last-launched tray silently steals every `rt daemon *` command from
    /// the running one. Both flavors bind the same path.
    ///
    /// A leaked socket file (pkill'd tray) is not a live tray: the probe is a
    /// CONNECT + request/response, never a file-existence check.
    static func launchSocketVerdict() -> FlavorLaunch.SocketVerdict {
        guard FileManager.default.fileExists(atPath: socketPath) else { return .claim }
        let answer = probeTray(atPath: socketPath)
        let holderFlavor = answer.flatMap(TrayHealth.flavor(inResponse:))
        let verdict = FlavorLaunch.socket(myFlavor: FlavorIdentity.flavorName(isDevBuild: BundleFlavor.isDevBuild),
                                          holderIsLive: answer != nil, holderFlavor: holderFlavor)
        switch verdict {
        case .claim:
            TrayLog.info("stale tray socket found, taking it over", ["socket": socketPath])
        case .exitDoubleLaunch:
            TrayLog.error("another tray owns the socket", ["socket": socketPath, "holder": holderFlavor ?? "unknown"])
        case .otherFlavorHolds:
            break
        }
        return verdict
    }

    enum SocketClaim: Equatable {
        case claimed
        case heldByPeer(flavor: String)
        /// A wrong-flavor holder that would not give the socket up.
        case heldByStuckHolder(flavor: String)
    }

    /// Taking the socket after a takeover: a holder that is still the other
    /// flavor's tray gets one more eviction, and a failure is reported by the
    /// caller rather than by vanishing mid-launch.
    static func claimSocket() -> SocketClaim {
        guard FileManager.default.fileExists(atPath: socketPath) else { return .claimed }
        let answer = probeTray(atPath: socketPath)
        let myFlavor = FlavorIdentity.flavorName(isDevBuild: BundleFlavor.isDevBuild)
        let holderFlavor = answer.flatMap(TrayHealth.flavor(inResponse:))
        switch SocketOwnership.decide(myFlavor: myFlavor, holderIsLive: answer != nil, holderFlavor: holderFlavor,
                                      takingOver: FlavorLaunchState.takingOver) {
        case .takeOver:
            TrayLog.info("stale tray socket found, taking it over", ["socket": socketPath])
            return .claimed
        case .standAside:
            TrayLog.error("another tray owns the socket", ["socket": socketPath, "holder": holderFlavor ?? "unknown"])
            return .heldByPeer(flavor: holderFlavor ?? "unknown")
        case .evictThenTakeOver:
            return evictHolder(holderFlavor: holderFlavor ?? "unknown", myFlavor: myFlavor)
        }
    }

    /// The socket is held by the other flavor's tray and this launch is
    /// taking the Mac over.
    ///
    /// `/flavor/retire` makes the holder give up its registrations but not its
    /// listener — only quitting frees the socket — so eviction is retire, then
    /// quit, then a bounded wait for the socket to actually go quiet. The
    /// order is forced: retire has to reach a holder that is still alive.
    private static func evictHolder(holderFlavor: String, myFlavor: String) -> SocketClaim {
        TrayLog.info("wrong-flavor tray holds the socket; evicting",
                     ["holder": holderFlavor, "flavor": myFlavor])
        switch request("POST", "/flavor/retire", atPath: socketPath, timeoutSeconds: 5) {
        case .none:
            TrayLog.warn("holder did not answer /flavor/retire", ["holder": holderFlavor])
        case .some(let reply) where HTTPReply.succeeded(reply):
            TrayLog.info("holder retired its registrations", ["reply": HTTPReply.parse(reply)?.body ?? ""])
        case .some(let reply):
            // A tray without the route 404s here and keeps both of its
            // registrations, so quitting it is all this eviction achieves.
            TrayLog.warn("holder refused to retire",
                         ["holder": holderFlavor, "status": HTTPReply.parse(reply)?.status ?? 0])
        }
        quitSiblingFlavor()

        for _ in 0..<10 {
            Thread.sleep(forTimeInterval: 0.5)
            guard probeTray(atPath: socketPath) != nil else {
                TrayLog.info("wrong-flavor tray released the socket", ["holder": holderFlavor])
                return .claimed
            }
        }
        TrayLog.error("wrong-flavor tray still owns the socket",
                      ["holder": holderFlavor, "socket": socketPath])
        return .heldByStuckHolder(flavor: holderFlavor)
    }

    /// Ask the other flavor's app to quit. `terminate()` is a quit Apple Event,
    /// so the holder runs its own `applicationWillTerminate` and takes its
    /// socket file with it.
    private static func quitSiblingFlavor() {
        guard let mine = Bundle.main.bundleIdentifier else { return }
        let sibling = FlavorIdentity.sibling(ofBundleID: mine)
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: sibling)
        guard !running.isEmpty else {
            TrayLog.warn("no running app to quit for the holder", ["bundleId": sibling])
            return
        }
        for app in running { _ = app.terminate() }
        TrayLog.info("asked the other flavor to quit", ["bundleId": sibling, "count": running.count])
    }

    /// CONNECT to the unix socket and require an actual HTTP answer, returned
    /// raw so the caller can read the holder's flavor out of it.
    private static func probeTray(atPath path: String) -> String? {
        request("GET", "/health", atPath: path, timeoutSeconds: 1)
    }

    /// One blocking request/response on the tray socket. Blocking +
    /// short-timeout on purpose: this runs on the main thread before the run
    /// loop starts, and must produce a verdict, not a future.
    private static func request(_ method: String, _ route: String, atPath path: String, timeoutSeconds: Int) -> String? {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        let capacity = MemoryLayout.size(ofValue: addr.sun_path)
        guard bytes.count < capacity else { return nil }
        withUnsafeMutablePointer(to: &addr.sun_path) { raw in
            raw.withMemoryRebound(to: CChar.self, capacity: capacity) { dst in
                for (i, b) in bytes.enumerated() { dst[i] = CChar(bitPattern: b) }
                dst[bytes.count] = 0
            }
        }

        var tv = timeval(tv_sec: timeoutSeconds, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        let connected = withUnsafePointer(to: &addr) { ptr -> Bool in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.connect(fd, sa, socklen_t(MemoryLayout<sockaddr_un>.size)) == 0
            }
        }
        // ECONNREFUSED here = the file is a leftover with no listener.
        guard connected else { return nil }

        let wire = "\(method) \(route) HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        let sent = wire.withCString { write(fd, $0, strlen($0)) }
        guard sent > 0 else { return nil }

        // Read to the server's close (every reply sets Connection: close) so
        // the body is never truncated mid-JSON.
        var response = Data()
        var buf = [UInt8](repeating: 0, count: 1024)
        while response.count < 8192 {
            let n = read(fd, &buf, buf.count)
            guard n > 0 else { break }
            response.append(contentsOf: buf[0..<n])
        }
        // A bound tray that never answers (wedged) reads 0/-1 on timeout and
        // is treated as dead — better to take the socket than to refuse to
        // start behind a hung process.
        guard !response.isEmpty else { return nil }
        return String(decoding: response, as: UTF8.self)
    }

    // MARK: - Start / Stop

    func start() {
        // Clean up stale socket
        if FileManager.default.fileExists(atPath: socketPath) {
            try? FileManager.default.removeItem(atPath: socketPath)
        }

        do {
            let params = NWParameters()
            params.defaultProtocolStack.transportProtocol = NWProtocolTCP.Options()
            params.requiredLocalEndpoint = NWEndpoint.unix(path: socketPath)

            listener = try NWListener(using: params)
            listener?.newConnectionHandler = { [weak self] connection in
                self?.handleConnection(connection)
            }
            listener?.stateUpdateHandler = { [socketPath] state in
                switch state {
                case .ready:
                    TrayLog.info("server listening on \(socketPath)")
                case .failed(let error):
                    TrayLog.error("server failed", ["err": String(describing: error)])
                default:
                    break
                }
            }
            listener?.start(queue: queue)
        } catch {
            TrayLog.error("failed to start tray server", ["err": String(describing: error)])
        }
    }

    func stop() {
        // Only a tray that actually bound may unlink the path. A tray that
        // quits without ever serving — a flavor stand-down, a translocated
        // copy — would otherwise delete the socket file out from under the
        // tray that IS serving, leaving it bound to a path nothing can reach.
        guard listener != nil else { return }
        listener?.cancel()
        listener = nil
        try? FileManager.default.removeItem(atPath: socketPath)
    }

    // MARK: - Connection Handling

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: queue)

        // Read the full request
        readFullRequest(connection: connection) { [weak self] data in
            guard let self = self, let data = data else {
                self?.sendResponse(connection: connection, status: 400, body: "{\"ok\":false}")
                return
            }

            // Parse HTTP request
            guard let str = String(data: data, encoding: .utf8) else {
                self.sendResponse(connection: connection, status: 400, body: "{\"ok\":false}")
                return
            }

            // Extract path and body
            let lines = str.components(separatedBy: "\r\n")
            guard let requestLine = lines.first else {
                self.sendResponse(connection: connection, status: 400, body: "{\"ok\":false}")
                return
            }

            let parts = requestLine.components(separatedBy: " ")
            let method = parts.first ?? ""
            let path = parts.count > 1 ? parts[1] : ""

            let bodyData: Data? = str.range(of: "\r\n\r\n").map { Data(String(str[$0.upperBound...]).utf8) }
            if let routes = self.routes {
                Task {
                    if let reply = await routes.handle(method: method, path: path, body: bodyData) {
                        self.sendResponse(connection: connection, status: reply.status, body: reply.body, path: path)
                    } else {
                        self.handleLegacy(method: method, path: path, str: str, connection: connection)
                    }
                }
                return
            }
            self.handleLegacy(method: method, path: path, str: str, connection: connection)
        }
    }

    private func handleLegacy(method: String, path: String, str: String, connection: NWConnection) {
            if method == "POST" && path == "/notify" {
                // Extract JSON body (after blank line)
                if let bodyRange = str.range(of: "\r\n\r\n") {
                    let bodyStr = String(str[bodyRange.upperBound...])
                    if let bodyData = bodyStr.data(using: .utf8),
                       let event = try? JSONDecoder().decode(NotificationEvent.self, from: bodyData) {

                        // Dispatch notification on main thread
                        DispatchQueue.main.async {
                            self.onNotification?(event)
                        }

                        self.sendResponse(connection: connection, status: 200, body: "{\"ok\":true}")
                        return
                    }
                }
                self.sendResponse(connection: connection, status: 400, body: "{\"ok\":false,\"error\":\"invalid body\"}", path: path)

            } else if method == "POST" && path == "/pane/focus" {
                // The rt daemon's pane:focus verb routes here: the tray owns
                // the herdr focus + the native terminal-window raise.
                // focusPaneById blocks on herdr shell-outs; that stays off the
                // main thread (this runs on the dispatch Task, not main), and
                // only the window raise inside focusPane hops to main.
                if let bodyRange = str.range(of: "\r\n\r\n"),
                   let bodyData = String(str[bodyRange.upperBound...]).data(using: .utf8),
                   let req = try? JSONDecoder().decode(FocusPaneRequest.self, from: bodyData) {
                    switch HerdrBridge.shared.focusPaneById(req.paneId) {
                    case .focused:
                        self.sendResponse(connection: connection, status: 200, body: "{\"ok\":true,\"focused\":true}")
                    case .notFound:
                        self.sendResponse(connection: connection, status: 404, body: "{\"ok\":false,\"error\":\"pane not found\"}", path: path)
                    case .herdrUnavailable:
                        self.sendResponse(connection: connection, status: 500, body: "{\"ok\":false,\"error\":\"herdr unavailable\"}", path: path)
                    }
                } else {
                    self.sendResponse(connection: connection, status: 400, body: "{\"ok\":false,\"error\":\"invalid body\"}", path: path)
                }

            } else if method == "GET" && path == "/health" {
                // The flavor field is what lets a starting tray tell a sibling
                // holder from a same-flavor double-launch.
                self.sendResponse(connection: connection, status: 200,
                                  body: TrayHealth.body(isDevBuild: BundleFlavor.isDevBuild))

            // The three lifecycle endpoints reply AFTER the op with its real
            // outcome — the old unconditional {"ok":true} ack read as success
            // even when the gate silently ate the op (2026-09-21). A missing
            // lifecycle is a 500 for the same reason: `?.` made it invisible.
            } else if method == "POST" && path == "/daemon/start" {
                let origin = DaemonOrigin.http(clientHeader: DaemonOrigin.header("X-RT-Client", in: str))
                Task { @MainActor in
                    guard let lifecycle = self.daemonLifecycle else {
                        self.sendResponse(connection: connection, status: 500, body: "{\"ok\":false,\"error\":\"no daemonLifecycle wired\"}", path: path)
                        return
                    }
                    let ok = await lifecycle.startDaemon(origin: origin)
                    self.sendResponse(connection: connection, status: ok ? 200 : 500, body: "{\"ok\":\(ok)}", path: ok ? nil : path)
                }

            } else if method == "POST" && path == "/daemon/stop" {
                let origin = DaemonOrigin.http(clientHeader: DaemonOrigin.header("X-RT-Client", in: str))
                Task { @MainActor in
                    guard let lifecycle = self.daemonLifecycle else {
                        self.sendResponse(connection: connection, status: 500, body: "{\"ok\":false,\"error\":\"no daemonLifecycle wired\"}", path: path)
                        return
                    }
                    let ok = await lifecycle.stopDaemon(origin: origin)
                    self.sendResponse(connection: connection, status: ok ? 200 : 500, body: "{\"ok\":\(ok)}", path: ok ? nil : path)
                }

            } else if method == "POST" && path == "/daemon/restart" {
                let origin = DaemonOrigin.http(clientHeader: DaemonOrigin.header("X-RT-Client", in: str))
                Task { @MainActor in
                    guard let lifecycle = self.daemonLifecycle else {
                        self.sendResponse(connection: connection, status: 500, body: "{\"ok\":false,\"error\":\"no daemonLifecycle wired\"}", path: path)
                        return
                    }
                    let ok = await lifecycle.restartDaemon(origin: origin)
                    self.sendResponse(connection: connection, status: ok ? 200 : 500, body: "{\"ok\":\(ok)}", path: ok ? nil : path)
                }

            } else if method == "POST" && path == "/flavor/retire" {
                // `rt flavor takeover`, run by the app being opened, calls
                // this on the OUTGOING tray before quitting it: this app gives
                // up every registration it holds (AppFlavorTeardown), so the
                // incoming app's jobs are the only ones left to load. The
                // reply waits for the teardown, so it states the post-state,
                // and the daemon stop goes through the lifecycle gate so the
                // client herd can't re-register the agent behind the retire.
                Task { @MainActor in
                    let result = await AppFlavorTeardown.run(lifecycle: self.daemonLifecycle)
                    self.sendResponse(connection: connection, status: result.retired ? 200 : 500,
                                      body: result.replyJSON, path: result.retired ? nil : path)
                }

            } else if method == "GET" && path == "/daemon/status" {
                let statusStr = self.daemonLifecycle.map { Self.statusName($0.status) } ?? "unknown"
                self.sendResponse(connection: connection, status: 200, body: "{\"ok\":true,\"status\":\"\(statusStr)\"}")

            } else {
                self.sendResponse(connection: connection, status: 404, body: "{\"ok\":false,\"error\":\"not found\"}", path: path)
            }
    }

    private func readFullRequest(connection: NWConnection, buffer: Data = Data(), completion: @escaping (Data?) -> Void) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { content, _, isComplete, error in
            var accumulated = buffer
            if let content = content {
                accumulated.append(content)
            }

            // Check if we have the full request (contains \r\n\r\n and body)
            if let str = String(data: accumulated, encoding: .utf8) {
                if str.contains("\r\n\r\n") {
                    // For POST, check Content-Length to know if we have the full body
                    let headers = str.components(separatedBy: "\r\n\r\n").first ?? ""
                    if let clRange = headers.range(of: "Content-Length: ", options: .caseInsensitive) {
                        let rest = String(headers[clRange.upperBound...])
                        let clStr = rest.components(separatedBy: "\r\n").first ?? "0"
                        if let contentLength = Int(clStr) {
                            let bodyStart = str.range(of: "\r\n\r\n")!.upperBound
                            let bodyLength = str[bodyStart...].utf8.count
                            if bodyLength >= contentLength {
                                completion(accumulated)
                                return
                            }
                        }
                    } else {
                        // GET request or no Content-Length — we have everything
                        completion(accumulated)
                        return
                    }
                }
            }

            if isComplete || error != nil {
                completion(accumulated.isEmpty ? nil : accumulated)
            } else {
                self.readFullRequest(connection: connection, buffer: accumulated, completion: completion)
            }
        }
    }

    /// Shared by /flavor/retire and the stand-down path in AppDelegate.
    static func retireHandDeckAgent() async -> HandDeckRetireOutcome {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let outcome = await HandDeckAgent.retire(home: home, uid: getuid(), runner: SystemCommandRunner(), fs: .system)
        logHandDeckOutcome(outcome)
        return outcome
    }

    static func logHandDeckOutcome(_ outcome: HandDeckRetireOutcome) {
        switch outcome {
        case .absent:
            break
        case .retired(let bootedOut, let archivedTo):
            TrayLog.info("retired hand-installed deck agent",
                         ["label": HandDeckAgent.label, "bootedOut": String(bootedOut), "archivedTo": archivedTo])
        case .failed(let err, let stage):
            TrayLog.warn("could not retire hand-installed deck agent",
                         ["label": HandDeckAgent.label, "err": err, "stage": String(describing: stage)])
        }
    }

    static func statusName(_ status: SMAppService.Status) -> String {
        switch status {
        case .enabled:          return "enabled"
        case .requiresApproval: return "requiresApproval"
        case .notRegistered:    return "notRegistered"
        case .notFound:         return "notFound"
        @unknown default:       return "unknown"
        }
    }

    private func sendResponse(connection: NWConnection, status: Int, body: String, path: String? = nil) {
        // Central error-visibility seam: every non-2xx reply from any route,
        // present or future, leaves a trace.
        if status >= 400 {
            TrayLog.warn("request failed", ["status": status, "path": path ?? "(unparsed)", "body": body])
        }
        let statusText: String
        switch status {
        case 200: statusText = "OK"
        case 400: statusText = "Bad Request"
        case 404: statusText = "Not Found"
        case 405: statusText = "Method Not Allowed"
        case 500: statusText = "Error"
        default: statusText = "Error"
        }

        let response = """
        HTTP/1.1 \(status) \(statusText)\r
        Content-Type: application/json\r
        Content-Length: \(body.utf8.count)\r
        Connection: close\r
        \r
        \(body)
        """

        if let data = response.data(using: .utf8) {
            connection.send(content: data, completion: .contentProcessed { _ in
                connection.cancel()
            })
        } else {
            connection.cancel()
        }
    }
}
