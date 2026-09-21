import Foundation

/// flock is the in-house terminal surface, so a focus request prefers it
/// whenever it is running.
///
/// This exists because `TerminalResolver` cannot answer for flock. That
/// resolver walks a pane's process ancestry looking for a known terminal
/// emulator's app bundle, and flock is not an emulator hosting herdr: it is a
/// herdr client that draws its own panes. Adding it to the emulator list
/// would technically match, through the herdr client flock spawns, but the
/// resolver's own fallback picks the lowest-pid match when several clients
/// are attached, so a machine running flock AND a terminal would sometimes
/// raise the wrong one. Preferring flock outright is the rule, not a tiebreak.
///
/// Nothing else about focusing changes. Which pane is focused is herdr's
/// answer, sent over the socket, and flock mirrors it; only the window raise
/// was ever missing.
public enum FlockPreference {
    /// Prod first: two copies can be installed, and when both are somehow
    /// running the one the user installed wins.
    public static let bundleIDs = ["dev.mattstack.Flock", "dev.mattstack.Flock.dev"]

    /// The bundle id of whichever flock is running, or nil when none is,
    /// which is the caller's signal to fall back to the ancestry walk.
    ///
    /// Takes the running set rather than reading it, so the choice is
    /// checkable without a running app.
    public static func preferred(runningBundleIDs running: Set<String>) -> String? {
        bundleIDs.first { running.contains($0) }
    }
}
