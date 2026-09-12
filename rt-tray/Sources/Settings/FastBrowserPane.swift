import SwiftUI
import MattstackCore

/// The one Settings surface for the finish gate: the extension row as the
/// checklist shows it, and the way back from a Skip for now.
struct FastBrowserPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var readiness: ReadinessModel
    @State private var steps: (title: String, steps: [String])?
    @State private var busy = false
    @State private var error: String?

    private static let rowId = "tool.fast-browser-extension"

    init(env: SettingsEnvironment) { self.env = env; self.readiness = env.readiness }

    var body: some View {
        Form {
            Section("Chrome extension") {
                if let row = readiness.row(Self.rowId) {
                    RowView(row: row, isChecking: readiness.checkingRowIds.contains(row.id), rowID: AXID.settingsFastBrowserRow,
                            actionID: AXID.settingsFastBrowserRowAction, statusID: AXID.settingsFastBrowserRowStatus) { show(row) }
                    if row.isWaived {
                        HStack {
                            Text("Skipped on this Mac").font(.caption).accessibilityIdentifier(AXID.settingsFastBrowserSkipped)
                            Spacer()
                            Button(busy ? "Un-skipping…" : "Un-skip") { unskip() }
                                .disabled(busy)
                                .accessibilityIdentifier(AXID.settingsFastBrowserUnskip)
                        }
                    }
                } else if let e = readiness.lastError {
                    Text("Couldn't read the checklist: \(e)").font(.caption).foregroundStyle(.red)
                } else {
                    Text(readiness.isLoading ? "Checking…" : "No extension row in this checklist.").foregroundStyle(.secondary)
                }
                if let error {
                    Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.settingsFastBrowserError)
                }
            }
        }
        .formStyle(.grouped)
        .task { await readiness.load() }
        .sheet(isPresented: Binding(get: { steps != nil }, set: { presented in
            guard !presented else { return }
            steps = nil
            Task { await readiness.recheckAll() }
        })) {
            if let steps { StepsSheet(title: steps.title, steps: steps.steps) }
        }
    }

    private func show(_ row: PlanRow) {
        guard let action = row.action, action.type == .steps else { return }
        steps = (title: row.title, steps: action.steps ?? [])
    }

    private func unskip() {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            error = await env.waivers.unwaive(Self.rowId)
        }
    }
}
