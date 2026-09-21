import Foundation
import MattstackCore

let flockPreferenceChecks: [Check] = [
    Check("a running flock is preferred") { c in
        c.expectEqual(
            FlockPreference.preferred(runningBundleIDs: ["dev.mattstack.Flock"]),
            "dev.mattstack.Flock")
    },
    Check("the dev bundle counts as flock") { c in
        c.expectEqual(
            FlockPreference.preferred(runningBundleIDs: ["dev.mattstack.Flock.dev"]),
            "dev.mattstack.Flock.dev")
    },
    // Two copies can be installed at once, so the choice has to be decided
    // rather than left to whichever the running set happens to yield first.
    Check("both running prefers prod") { c in
        let running: Set<String> = ["dev.mattstack.Flock.dev", "dev.mattstack.Flock"]
        c.expectEqual(FlockPreference.preferred(runningBundleIDs: running), "dev.mattstack.Flock")
    },
    // The signal to fall back to the ancestry walk. A terminal running is not
    // flock running.
    Check("no flock running prefers nothing") { c in
        c.expect(
            FlockPreference.preferred(runningBundleIDs: ["com.mitchellh.ghostty"]) == nil,
            "a machine with no flock must fall through to the ancestry walk")
        c.expect(
            FlockPreference.preferred(runningBundleIDs: []) == nil,
            "an empty running set must fall through too")
    },
]
