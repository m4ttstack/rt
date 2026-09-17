import SwiftUI
import ServiceManagement
import MattstackCore

struct GeneralPane: View {
    let env: SettingsEnvironment
    @State private var startAtLogin = SMAppService.mainApp.status == .enabled
    @State private var autoUpdates = false
    @State private var devModeBusy = false
    @State private var devModeError: String?
    @State private var devModeOn: Bool
    @State private var confirmingSwitch = false

    init(env: SettingsEnvironment) {
        self.env = env
        _devModeOn = State(initialValue: env.isDevBuild)
    }

    var body: some View {
        Form {
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
                Toggle("Dev mode", isOn: $devModeOn)
                    .toggleStyle(.switch).controlSize(.small)
                    .disabled(devModeBusy)
                    .accessibilityIdentifier(AXID.settingsGeneralDevMode)
                    .onChange(of: devModeOn) { _, on in
                        // The snap-back write on Cancel re-enters here already matching the flavor.
                        guard on != env.isDevBuild else { return }
                        confirmingSwitch = true
                    }
                Text(env.isDevBuild ? "On: this is the dev app (mattstack-dev.app)." : "Off: this is the installed app (mattstack.app).")
                    .font(.caption).foregroundStyle(.secondary)
                if let devModeError { Text(devModeError).font(.caption).foregroundStyle(.red) }
            }
            Section { LabeledContent("Version") { Text(env.version) } }
        }
        .formStyle(.grouped)
        .onAppear {
            autoUpdates = env.updater.automaticallyChecks
            startAtLogin = SMAppService.mainApp.status == .enabled
        }
        .alert(devModeOn ? "Switch to the dev app?" : "Switch to the installed app?", isPresented: $confirmingSwitch) {
            Button("Switch") { performFlavorSwitch() }
            Button("Cancel", role: .cancel) { devModeOn = env.isDevBuild }
        } message: {
            Text("This quits \(env.isDevBuild ? "mattstack-dev.app" : "mattstack.app") and launches the other flavor.")
        }
    }

    private func performFlavorSwitch() {
        devModeBusy = true
        devModeError = nil
        Task {
            let verb = "settings dev-mode"
            do {
                // `rt settings dev-mode <dev|prod>` drops its TTY requirement when the target is given, so the app can spawn it.
                let r = try await env.rt.run(["settings", "dev-mode", env.isDevBuild ? "prod" : "dev"], stdin: nil)
                if let e = r.userError { devModeError = e.message }
                else if r.exitCode != 0 { devModeError = r.failureCopy(verb: verb) }
            } catch {
                devModeError = (error as? RtClientError)?.copy ?? "rt \(verb) failed to start."
            }
            if let devModeError { TrayLog.warn("dev-mode handoff failed", ["err": devModeError]) }
            devModeBusy = false
            // A failed handoff leaves this app running; the switch shows the real flavor again.
            if devModeError != nil { devModeOn = env.isDevBuild }
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
