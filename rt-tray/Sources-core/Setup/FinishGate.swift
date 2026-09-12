import Foundation
import Combine

/// Copy and rules for the finish gate: finish-gated rows block the wizard's
/// Finish until ready, skipped, or waived on this Mac by `rt setup waive`.
public enum FinishGate {
    public static let waivedNotePrefix = "Skipped on this Mac"
    public static let beforeYouFinishTitle = "Before you finish"
    public static let skipSheetTitle = "Skip the Fast Browser extension?"
    public static let skipSheetBody = "Without the Fast Browser extension, agents cannot capture screenshots or annotate evidence from your browser. You can load it later from Settings."
    public static let skipSheetConfirm = "Skip for now"
    public static let skipSheetCancel = "Cancel"

    public static func headline(blocked: Int) -> String {
        blocked == 1 ? "One step left before you finish" : "\(blocked) steps left before you finish"
    }
}

public extension PlanRow {
    /// rt marks a waived row by its note, the same way a "works without"
    /// row is recognised; the contract carries no separate flag.
    var isWaived: Bool { finishGated && (optionalNote?.hasPrefix(FinishGate.waivedNotePrefix) ?? false) }
}

/// Runs the two waiver verbs and refreshes the plan after either succeeds,
/// so the row's shape on screen always comes from rt, never a local guess.
@MainActor
public final class WaiverClient {
    private let rt: RtRunning
    private let readiness: ReadinessModel

    public init(rt: RtRunning, readiness: ReadinessModel) {
        self.rt = rt; self.readiness = readiness
    }

    /// nil once the verb succeeded and the plan was re-read; otherwise the
    /// user-facing failure copy, with the plan left as it was.
    public func waive(_ rowId: String) async -> String? { await run("waive", rowId) }
    public func unwaive(_ rowId: String) async -> String? { await run("unwaive", rowId) }

    private func run(_ verb: String, _ rowId: String) async -> String? {
        let args = ["setup", verb, rowId, "--json"]
        do {
            let result = try await rt.run(args, stdin: nil)
            if let e = result.userError { return e.message }
            if result.exitCode != 0 { return result.failureCopy(verb: "setup \(verb) \(rowId)") }
        } catch {
            return (error as? RtClientError)?.copy ?? "rt setup \(verb) failed to start."
        }
        await readiness.recheckAll()
        return nil
    }
}

/// The Done screen's state: which rows block Finish, which are merely still
/// to do, and the Skip for now sheet. Nothing is listed until the
/// post-install re-check lands, since the model still holds the pre-Install
/// plan before then; the gate reads closed while that check is in flight.
/// A check that fails reads open with the failure shown: a gate that could
/// not be evaluated must never strand the wizard, and the pre-Install rows
/// are not evidence either way.
@MainActor
public final class DoneModel: ObservableObject {
    public enum CheckState: Equatable, Sendable {
        case unchecked, checking, checked
        case failed(String)
    }

    /// How long a post-install check may run before it is treated as failed.
    /// `RtClient.run` has no timeout of its own, so without this a hung rt
    /// would hold Finish shut with nothing on screen to act on.
    public static let defaultCheckTimeout: TimeInterval = 30

    @Published public private(set) var checkState: CheckState = .unchecked
    @Published public var skipTarget: PlanRow?
    @Published public private(set) var skipError: String?
    @Published public private(set) var isSkipping = false

    private let readiness: ReadinessModel
    private let waivers: WaiverClient
    private let checkTimeout: TimeInterval
    private var checkGeneration = 0
    private var forward: AnyCancellable?

    public init(readiness: ReadinessModel, waivers: WaiverClient, checkTimeout: TimeInterval = DoneModel.defaultCheckTimeout) {
        self.readiness = readiness; self.waivers = waivers; self.checkTimeout = checkTimeout
        forward = readiness.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    public var hasCheckedSincePostInstall: Bool { checkState == .checked }
    public var blockedRows: [PlanRow] { hasCheckedSincePostInstall ? readiness.finishBlockedRows : [] }
    public var stillToDoRows: [PlanRow] { hasCheckedSincePostInstall ? readiness.outstandingManualRows : [] }
    /// True after a post-install check failed or timed out and no later one succeeded.
    public var refreshFailed: Bool { refreshError != nil }
    public var refreshError: String? {
        if case .failed(let message) = checkState { return message }
        return nil
    }
    /// The one boolean Finish and the window's close buttons both follow:
    /// closed while a check is in flight, the plan's answer once it landed,
    /// open when the check could not be completed.
    public var finishEnabled: Bool {
        switch checkState {
        case .checked: return readiness.finishBlockedBy.isEmpty
        case .failed: return true
        case .unchecked, .checking: return false
        }
    }

    public var headline: String {
        let blocked = blockedRows.count
        if blocked > 0 { return FinishGate.headline(blocked: blocked) }
        let outstanding = stillToDoRows.count
        return outstanding == 0 ? "Everything's working" : "Installed, with \(outstanding) step\(outstanding == 1 ? "" : "s") left for you"
    }

    /// Every arrival at Done checks from scratch: the previous run's rows are
    /// never presented as fresh. A failed refresh leaves `readiness` holding
    /// the stale pre-Install plan, which is likewise never presented as
    /// confirmed: the rows stay hidden and the failure is shown instead. A
    /// check that outlives the watchdog is reported the same way, and its
    /// late answer, if one arrives, still becomes the truth.
    public func checkPostInstall() async {
        checkGeneration += 1
        let generation = checkGeneration
        checkState = .checking
        let seconds = checkTimeout
        let watchdog = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard let self, !Task.isCancelled, self.checkGeneration == generation, self.checkState == .checking else { return }
            self.checkState = .failed("rt setup plan did not answer within \(Int(seconds.rounded())) s")
        }
        await readiness.recheckAll()
        watchdog.cancel()
        guard checkGeneration == generation else { return }
        checkState = readiness.lastRefreshFailed ? .failed(readiness.lastError ?? "unknown error") : .checked
    }

    public func retryCheck() async { await checkPostInstall() }

    public func requestSkip(_ row: PlanRow) { skipError = nil; skipTarget = row }
    public func cancelSkip() { skipTarget = nil; skipError = nil }

    /// Success closes the sheet; the re-read plan moves the row to Still to
    /// do. Failure keeps the sheet up with the message and the gate closed.
    public func confirmSkip() async {
        guard let row = skipTarget else { return }
        isSkipping = true
        defer { isSkipping = false }
        if let error = await waivers.waive(row.id) {
            skipError = error
            return
        }
        skipTarget = nil
        skipError = nil
    }
}
