import SwiftUI
import MattstackCore

struct ChecklistScreen: View {
    @ObservedObject var model: ReadinessModel
    let permissions: PermissionsService
    let rt: RtRunning
    @State private var connect: (row: PlanRow, fields: [ActionField], alternatives: [ActionAlternative])?
    @State private var steps: (title: String, steps: [String])?
    @State private var actionError: (rowId: String, message: String)?

    var body: some View {
        VStack(spacing: 0) {
            if model.lastError != nil {
                Label("Couldn't load the checklist, so Install can't start yet. Re-check to try again.", systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.top, 12)
            }
            Form {
                ForEach(model.groups) { group in
                    Section(group.title) {
                        ForEach(group.rows) { row in
                            RowView(row: row, isChecking: model.checkingRowIds.contains(row.id)) { perform(row) }
                            if let actionError, actionError.rowId == row.id {
                                Text(actionError.message).font(.caption).foregroundStyle(.red)
                                    .accessibilityIdentifier(AXID.checklistRowError(row.id))
                            }
                        }
                        if group.id == "mac", model.fdaNeedsRelaunch {
                            HStack {
                                Text("Full Disk Access was granted. Relaunch mattstack to apply it.").font(.caption)
                                Spacer()
                                Button("Relaunch mattstack") { AppRelaunch.relaunchInPlace(resumeAt: .checklist) }.accessibilityIdentifier(AXID.checklistRelaunch)
                            }
                        }
                    }
                }
            }
            .formStyle(.grouped)
            HStack {
                Text(footerText).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Re-check") { actionError = nil; Task { await model.recheckAll() } }.controlSize(.small).accessibilityIdentifier(AXID.checklistRecheck)
            }
            .padding(.horizontal, 20).padding(.vertical, 6)
        }
        .sheet(isPresented: Binding(get: { connect != nil }, set: { if !$0 { connect = nil } })) {
            if let c = connect {
                ConnectSheet(title: c.row.title, fields: c.fields, alternatives: c.alternatives) { values, alt in
                    guard let action = c.row.action else { return }
                    actionError = nil
                    run(RowActionDispatcher.dispatch(action, fieldValues: values, alternative: alt), for: c.row)
                }
            }
        }
        .sheet(isPresented: Binding(get: { steps != nil }, set: { if !$0 { steps = nil } })) {
            if let s = steps { StepsSheet(title: s.title, steps: s.steps) }
        }
        // .contain: without it, the footer HStack's only interactive child
        // (Re-check) reports THIS screen-level identifier instead of its own
        // -- same fix as InstallScreen's stepRow.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.checklistScreen)
        .onChange(of: model.lastError) { _, e in
            if let e { TrayLog.warn("checklist load failed", ["err": e]) }
        }
    }

    private var footerText: String {
        if model.groups.isEmpty { return model.lastError == nil ? "Checking…" : "" }
        if model.canInstall { return "Everything required is ready." }
        let n = model.requiredMissing.count
        return n == 1 ? "1 required item left." : "\(n) required items left."
    }

    private func perform(_ row: PlanRow) {
        guard let action = row.action else { return }
        actionError = nil
        run(RowActionDispatcher.dispatch(action, fieldValues: nil, alternative: nil), for: row)
    }

    private func run(_ dispatched: DispatchedAction, for row: PlanRow) {
        switch dispatched {
        case .openSettings(let target):
            permissions.openSettings(target)
        case .requestPermission(let which):
            Task { _ = await permissions.request(which); await model.afterAction(rowId: row.id) }
        case .rtVerb(let args, let stdin):
            // Redaction over-approximates: stdin carries a secret for
            // `connect`/`owner-once` but only a folder path for
            // `choose-folder`, which still redacts here. Its verb exits 2 on
            // every validation failure, and exit 2 routes through the JSON
            // envelope instead of this copy, so the redacted branch is
            // reachable for it only on a non-validation crash. Narrowing the
            // signal to the secret-carrying action types is a named follow-up.
            let redactStderr = stdin != nil
            model.beginChecking(row.id)
            Task {
                defer { model.endChecking(row.id) }
                let verb = args.joined(separator: " ")
                do {
                    let result = try await rt.run(args, stdin: stdin)
                    if let e = result.userError(redactStderr: redactStderr) {
                        TrayLog.warn("row action failed", ["row": row.id, "err": e.message])
                        actionError = (row.id, e.message)
                    } else if result.exitCode != 0 {
                        let copy = result.failureCopy(verb: verb, redactStderr: redactStderr)
                        TrayLog.warn("row action failed", ["row": row.id, "err": copy])
                        actionError = (row.id, copy)
                    }
                } catch {
                    let copy = (error as? RtClientError)?.copy ?? "rt \(verb) failed to start."
                    TrayLog.warn("row action failed", ["row": row.id, "err": copy])
                    actionError = (row.id, copy)
                }
                await model.afterAction(rowId: row.id)
            }
        case .chooseFolder(let startAt):
            guard let action = row.action else { return }
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.canCreateDirectories = true
            panel.allowsMultipleSelection = false
            panel.prompt = "Use this folder"
            if let s = startAt { panel.directoryURL = URL(fileURLWithPath: s) }
            guard panel.runModal() == .OK, let url = panel.url else { return }
            run(RowActionDispatcher.dispatch(action, fieldValues: ["root": url.path], alternative: nil), for: row)
        case .openURL(let url):
            NSWorkspace.shared.open(url)
        case .showSteps(let list):
            steps = (row.title, list)
        case .collectFields(let fields, _, let alternatives):
            connect = (row, fields, alternatives)
        case .none:
            break
        }
    }

}
