import SwiftUI
import MattstackCore

struct DoneScreen: View {
    @ObservedObject var model: DoneModel
    @ObservedObject var install: InstallRunModel
    @ObservedObject var readiness: ReadinessModel
    let isOwner: Bool
    let onInvite: () -> Void
    @State private var steps: (title: String, steps: [String])?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Image(systemName: headlineSymbol).font(.system(size: 40)).foregroundStyle(headlineTint)
                VStack(alignment: .leading) {
                    Text(model.headline).font(.title3.weight(.semibold))
                    Text(verifySummary).foregroundStyle(.secondary)
                }
            }
            Form {
                Section("Where things live") {
                    LabeledContent("Menu bar") { Text("the m at the top right") }
                    LabeledContent("Terminal") { Text("rt — open a new terminal window").font(.system(.body, design: .monospaced)) }
                    LabeledContent("Board") { Link("https://board.mattstack", destination: URL(string: "https://board.mattstack")!) }
                }
                if !model.blockedRows.isEmpty {
                    Section(FinishGate.beforeYouFinishTitle) {
                        ForEach(model.blockedRows) { row in
                            VStack(alignment: .leading, spacing: 6) {
                                RowView(row: row, isChecking: false, rowID: AXID.doneBeforeYouFinishRow(row.id),
                                        actionID: AXID.doneBeforeYouFinishRowAction(row.id), statusID: AXID.doneBeforeYouFinishRowStatus(row.id)) { show(row) }
                                HStack {
                                    Spacer()
                                    Button(FinishGate.skipSheetConfirm) { model.requestSkip(row) }
                                        .controlSize(.small)
                                        .accessibilityIdentifier(AXID.doneSkipRow(row.id))
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
            .formStyle(.grouped).scrollDisabled(true)
            HStack {
                Button("Open the board", action: openBoard).accessibilityIdentifier(AXID.doneOpenBoard)
                if isOwner { Button("Invite teammates…", action: onInvite).accessibilityIdentifier(AXID.doneInvite) }
                Spacer()
            }
            Spacer()
        }
        .padding(24)
        .task { await model.checkPostInstall() }
        .sheet(isPresented: Binding(get: { steps != nil }, set: { presented in
            guard !presented else { return }
            steps = nil
            // The row's real state changes outside the app (Chrome, a
            // download) -- only the sheet's dismissal tells us to look again.
            Task { await readiness.recheckAll() }
        })) {
            if let steps { StepsSheet(title: steps.title, steps: steps.steps) }
        }
        .sheet(item: $model.skipTarget) { _ in
            SkipConfirmSheet(model: model)
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
        guard let action = row.action else { return }
        if action.type == .openURL {
            // Mirrors RowActionDispatcher's own rejection: an unsupported
            // scheme does nothing rather than presenting a title with no steps.
            guard let raw = action.url, let url = URL(string: raw), url.scheme?.hasPrefix("http") == true else { return }
            NSWorkspace.shared.open(url)
            Task { await readiness.recheckAll() }
            return
        }
        steps = (title: row.title, steps: action.steps ?? [])
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
                Button(FinishGate.skipSheetConfirm, role: .destructive) { Task { await model.confirmSkip() } }
                    .disabled(model.isSkipping)
                    .accessibilityIdentifier(AXID.doneSkipConfirmSkip)
            }
        }
        .padding(20).frame(width: 440)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.doneSkipConfirm)
    }
}
