import SwiftUI
import MattstackCore

/// One pane's SwiftUI content, sized for the settings window. The tab strip
/// itself is AppKit (NSTabViewController toolbar tabs) in
/// SettingsWindowController; SwiftUI TabView's titlebar rendering on
/// macOS 26 produced an oversized floating pill that no modifier tames.
enum SettingsPaneContent {
    @ViewBuilder static func view(for pane: SettingsPane, env: SettingsEnvironment) -> some View {
        Group {
            switch pane {
            case .general: GeneralPane(env: env)
            case .permissions: PermissionsPane(env: env)
            case .fastBrowser: FastBrowserPane(env: env)
            case .team: TeamPane(env: env)
            case .uninstall: UninstallPane(env: env)
            }
        }
        .frame(width: 680, height: 620)
    }
}
