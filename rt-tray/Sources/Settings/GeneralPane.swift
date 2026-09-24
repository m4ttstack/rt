import AppKit
import SwiftUI
import ServiceManagement
import MattstackCore

struct GeneralPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var readiness: ReadinessModel
    @State private var chooseRow: PlanRow?
    @State private var startAtLogin = SMAppService.mainApp.status == .enabled
    @State private var autoUpdates = false
    @State private var switchError: String?
    @State private var confirmingSwitch = false

    init(env: SettingsEnvironment) {
        self.env = env
        self.readiness = env.readiness
    }

    var body: some View {
        Form {
            Section("Writing style") {
                if let row = readiness.row("skills.writing-style") {
                    RowView(row: row, isChecking: readiness.checkingRowIds.contains(row.id), rowID: AXID.settingsWritingStyleRow,
                            actionID: AXID.settingsWritingStyleRowAction, statusID: AXID.settingsWritingStyleRowStatus) {
                        if row.action?.type == .choose { chooseRow = row }
                    }
                    if readiness.lastRefreshFailed, let e = readiness.lastError {
                        Text("Couldn't re-read the checklist: \(e)").font(.caption).foregroundStyle(.red)
                    }
                } else if let e = readiness.lastError {
                    Text("Couldn't read the checklist: \(e)").font(.caption).foregroundStyle(.red)
                } else {
                    Text(readiness.isLoading ? "Checking…" : "No writing-style row in this checklist.").foregroundStyle(.secondary)
                }
            }
            Section("Startup") {
                Toggle("Start mattstack at login", isOn: $startAtLogin).toggleStyle(.switch).controlSize(.small)
                    .onChange(of: startAtLogin) { _, on in toggleLogin(on) }
                    .accessibilityIdentifier(AXID.settingsGeneralStartAtLogin)
            }
            Section("mattstack window") {
                Toggle("Open .mattstack links in the mattstack window",
                       isOn: Binding(
                           get: { UserDefaults.standard.object(forKey: "MSShellHandoff") == nil
                                  || UserDefaults.standard.bool(forKey: "MSShellHandoff") },
                           set: { UserDefaults.standard.set($0, forKey: "MSShellHandoff") }))
                    .toggleStyle(.switch).controlSize(.small)
                    .accessibilityIdentifier(AXID.settingsGeneralShellHandoff)
            }
            Section("Updates") {
                Toggle("Check for updates automatically", isOn: $autoUpdates).toggleStyle(.switch).controlSize(.small)
                    .disabled(!env.updater.isEnabled)
                    .onChange(of: autoUpdates) { _, on in env.updater.automaticallyChecks = on }
                    .accessibilityIdentifier(AXID.settingsGeneralAutoUpdates)
                HStack {
                    Button("Check Now") { env.updater.checkForUpdatesFromMenu() }.disabled(!env.updater.canCheckForUpdates)
                        .accessibilityIdentifier(AXID.settingsGeneralCheckNow)
                    if !env.updater.isEnabled { Text(env.isDevBuild ? "Updates are off in the dev flavor." : "Updates are off in this build.").font(.caption).foregroundStyle(.secondary) }
                }
            }
            Section("Developer") {
                Button(FlavorSwitchCopy.buttonTitle(isDevBuild: env.isDevBuild)) { confirmingSwitch = true }
                    .accessibilityIdentifier(AXID.settingsGeneralSwitchApp)
                Text(FlavorSwitchCopy.caption(isDevBuild: env.isDevBuild))
                    .font(.caption).foregroundStyle(.secondary)
                if let switchError { Text(switchError).font(.caption).foregroundStyle(.red) }
            }
            Section { LabeledContent("Version") { Text(env.version) } }
        }
        .formStyle(.grouped)
        .task { await readiness.loadIfNeeded() }
        .sheet(item: $chooseRow) { row in
            ChooseSheet(row: row) { id in
                let failure = await ChoiceClient(rt: env.rt).choose(verb: row.action?.verb ?? [], id: id)
                if failure == nil { await readiness.recheckAll() }
                return failure
            }
        }
        .onAppear {
            autoUpdates = env.updater.automaticallyChecks
            startAtLogin = SMAppService.mainApp.status == .enabled
        }
        .alert(FlavorSwitchCopy.confirmTitle(isDevBuild: env.isDevBuild), isPresented: $confirmingSwitch) {
            Button("Open") { openOtherApp() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(FlavorSwitchCopy.confirmBody(isDevBuild: env.isDevBuild))
        }
    }

    /// Opened this way the other app counts as opened by hand, so it takes
    /// the Mac over by itself, quitting this one on the way.
    private func openOtherApp() {
        switchError = nil
        guard let mine = Bundle.main.bundleIdentifier,
              let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: FlavorIdentity.sibling(ofBundleID: mine))
        else {
            switchError = FlavorSwitchCopy.notInstalled(isDevBuild: env.isDevBuild)
            return
        }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            guard let error else { return }
            TrayLog.warn("could not open the other app", ["url": url.path, "err": String(describing: error)])
            Task { @MainActor in switchError = "Couldn't open \(url.lastPathComponent)." }
        }
    }

    private func toggleLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register(); LoginItemPreference.isOptedOut = false }
            else { try SMAppService.mainApp.unregister(); LoginItemPreference.isOptedOut = true }
        } catch { TrayLog.error("login item toggle failed", ["err": String(describing: error)]) }
        startAtLogin = SMAppService.mainApp.status == .enabled
    }
}
