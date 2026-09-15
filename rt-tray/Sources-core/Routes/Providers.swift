import Foundation

public protocol PermissionsProviding: Sendable {
    func snapshot() async -> PermissionSnapshot
    func request(_ which: String) async -> Bool
}

public protocol UpdateChecking: Sendable { func checkForUpdates() async -> Bool }
public protocol VersionProviding: Sendable { func versionInfo() -> VersionInfo }

public protocol WindowOpening: Sendable {
    /// True when the shell window took the navigation; false lets the
    /// caller (an app's handoff middleware) serve the page normally.
    func open(url: String) async -> Bool
}
