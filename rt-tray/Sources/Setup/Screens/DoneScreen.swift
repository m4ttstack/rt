import SwiftUI
import MattstackCore

struct DoneScreen: View {
    @ObservedObject var model: DoneModel
    @ObservedObject var install: InstallRunModel
    @ObservedObject var readiness: ReadinessModel
    let isOwner: Bool
    let onInvite: () -> Void
    @State private var steps: (title: String, steps: [String])?
    @State private var choose: PlanRow?

    var body: some View {
        // No outer padding: the grouped Form insets its own boxes 20pt, and the
        // headline and button bar use the same 20pt so every left edge lines up.
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: headlineSymbol).font(.system(size: 36)).foregroundStyle(headlineTint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.headline).font(.title3.weight(.semibold))
                    Text(verifySummary).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 20).padding(.top, 20)
            if model.refreshFailed {
                HStack {
                    Text("Couldn't confirm the checklist: \(model.refreshError ?? "unknown error")")
                        .font(.callout).foregroundStyle(.red)
                        .accessibilityIdentifier(AXID.doneRefreshError)
                    Spacer()
                    Button("Try again") { Task { await model.retryCheck() } }
                        .controlSize(.small)
                        .accessibilityIdentifier(AXID.doneRetryCheck)
                }
                .padding(.horizontal, 20).padding(.top, 12)
            }
            Form {
                Section("Where things live") {
                    LabeledContent("Menu bar") { Text("the m icon, top right") }
                    LabeledContent("Terminal") { Text("run rt in a new terminal window") }
                    LabeledContent("Board") { Link("board.mattstack", destination: URL(string: "https://board.mattstack")!) }
                }
                if !model.blockedRows.isEmpty {
                    Section(FinishGate.beforeYouFinishTitle) {
                        ForEach(model.blockedRows) { row in
                            VStack(alignment: .leading, spacing: 6) {
                                RowView(row: row, isChecking: false, rowID: AXID.doneBeforeYouFinishRow(row.id),
                                        actionID: AXID.doneBeforeYouFinishRowAction(row.id), statusID: AXID.doneBeforeYouFinishRowStatus(row.id)) { show(row) }
                                if row.waivable {
                                    HStack {
                                        Spacer()
                                        Button(FinishGate.skipSheetConfirm) { model.requestSkip(row) }
                                            .controlSize(.small)
                                            .accessibilityIdentifier(AXID.doneSkipRow(row.id))
                                    }
                                }
                            }
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier(AXID.doneBeforeYouFinish)
                }
                if !model.stillToDoRows.isEmpty {
                    Section("Still to do") {
                        ForEach(model.stillToDoRows) { row in
                            RowView(row: row, isChecking: false, rowID: AXID.doneStillToDoRow(row.id),
                                    actionID: AXID.doneStillToDoRowAction(row.id), statusID: AXID.doneStillToDoRowStatus(row.id)) { show(row) }
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier(AXID.doneStillToDo)
                }
            }
            .formStyle(.grouped)
            HStack {
                Button("Open the board", action: openBoard).accessibilityIdentifier(AXID.doneOpenBoard)
                if isOwner { Button("Invite teammates…", action: onInvite).accessibilityIdentifier(AXID.doneInvite) }
                Spacer()
            }
            .controlSize(.regular)
            .padding(.horizontal, 20).padding(.bottom, 10)
        }
        .task { await model.checkPostInstall() }
        .sheet(isPresented: Binding(get: { steps != nil }, set: { presented in
            guard !presented else { return }
            steps = nil
            // The row's real state changes outside the app (Chrome, a
            // download) -- only the sheet's dismissal tells us to look again.
            Task { await model.retryCheck() }
        })) {
            if let steps { StepsSheet(title: steps.title, steps: steps.steps) }
        }
        .sheet(item: $model.skipTarget) { _ in
            SkipConfirmSheet(model: model)
        }
        .sheet(item: $choose) { row in
            ChooseSheet(row: row) { id in
                let failure = await model.choices.choose(verb: row.action?.verb ?? [], id: id)
                if failure == nil { await model.retryCheck() }
                return failure
            }
        }
        // .contain: without it, the plain HStack's buttons (Open the board,
        // Invite teammates…) report THIS screen-level identifier instead of
        // their own -- same fix as InstallScreen's stepRow and ChecklistScreen.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.doneScreen)
    }

    private var headlineSymbol: String {
        if !model.blockedRows.isEmpty { return "exclamationmark.triangle" }
        return model.stillToDoRows.isEmpty ? "checkmark.seal.fill" : "checkmark.seal"
    }
    private var headlineTint: Color {
        if !model.blockedRows.isEmpty { return .yellow }
        return model.stillToDoRows.isEmpty ? .green : .accentColor
    }

    private func show(_ row: PlanRow) {
        guard let action = row.action, let route = DoneActions.route(action) else { return }
        switch route {
        case .openURL(let url):
            NSWorkspace.shared.open(url)
            Task { await model.retryCheck() }
        case .steps(let list):
            steps = (title: row.title, steps: list)
        case .recheck:
            Task { await model.retryCheck() }
        case .choose:
            choose = row
        }
    }

    private var verifySummary: String {
        let verify = install.steps.first { $0.id == "verify" }
        let n = install.steps.filter { $0.state == .done }.count
        return verify?.detail.map { "\($0) · \(n) steps done" } ?? "\(n) steps done"
    }

    /// Stub mode never opens a real browser tab -- there's no real board to
    /// show, and a UI test driving this button shouldn't launch one.
    private func openBoard() {
        guard !BundleFlavor.isStubActive else {
            TrayLog.info("open board skipped (stub mode)")
            return
        }
        NSWorkspace.shared.open(URL(string: "https://board.mattstack")!)
    }
}

/// Confirms a Skip for now with the cost stated. Buttons are driven by
/// their wording from the VM walkthrough, so the labels are the contract.
struct SkipConfirmSheet: View {
    @ObservedObject var model: DoneModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FinishGate.skipSheetTitle).font(.headline)
            Text(FinishGate.skipSheetBody).fixedSize(horizontal: false, vertical: true)
            if let e = model.skipError {
                Text(e).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.doneSkipConfirmError)
            }
            HStack {
                Spacer()
                Button(FinishGate.skipSheetCancel) { model.cancelSkip() }
                    .keyboardShortcut(.cancelAction)
                    .disabled(model.isSkipping)
                    .accessibilityIdentifier(AXID.doneSkipConfirmCancel)
                // `role: .destructive` alone draws nothing outside an alert on
                // macOS; the prominent style plus the red tint is what shows.
                Button(FinishGate.skipSheetConfirm, role: .destructive) { Task { await model.confirmSkip() } }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .disabled(model.isSkipping)
                    .accessibilityIdentifier(AXID.doneSkipConfirmSkip)
            }
        }
        .padding(20).frame(width: 440)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.doneSkipConfirm)
    }
}
