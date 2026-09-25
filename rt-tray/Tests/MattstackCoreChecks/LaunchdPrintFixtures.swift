import Foundation

/// launchd print output for com.mattstack.daemon. Tabs are escapes because
/// the parser keys on them and an editor may expand real ones.
enum LaunchdPrintFixtures {
    /// A healthy prod 2.12.0 job, captured 2026-09-24. `last exit code = 1`
    /// is left over from an earlier run while the current one is up.
    static let healthy = """
    gui/501/com.mattstack.daemon = {
    \tactive count = 1
    \tpath = (submitted by smd.543)
    \ttype = Submitted
    \tmanaged_by = com.apple.xpc.ServiceManagement
    \tstate = running

    \tprogram identifier = Contents/MacOS/rt (mode: 2)
    \tparent bundle identifier = com.mattstack.app
    \tparent bundle version = 2012000
    \tBTM uuid = E7BBB141-9DDD-4DBB-8EF1-51C7BFB507A9
    \targuments = {
    \t\tContents/MacOS/rt
    \t\t--daemon
    \t}

    \tinherited environment = {
    \t\tSSH_AUTH_SOCK => /var/run/com.apple.launchd.TzpwIuqAEF/Listeners
    \t}

    \tdefault environment = {
    \t\tPATH => /usr/bin:/bin:/usr/sbin:/sbin
    \t}

    \tenvironment = {
    \t\tOSLogRateLimit => 64
    \t\tMATTSTACK_FLAVOR => prod
    \t\tPATH => /usr/bin:/bin:/usr/sbin:/sbin
    \t\tXPC_SERVICE_NAME => com.mattstack.daemon
    \t}

    \tdomain = gui/501 [100057]
    \tasid = 100057
    \tminimum runtime = 10
    \texit timeout = 30
    \truns = 3
    \tpid = 28474
    \timmediate reason = semaphore
    \tforks = 22730
    \texecs = 1
    \tinitialized = 1
    \ttrampolined = 1
    \tstarted suspended = 0
    \tproxy started suspended = 0
    \tchecked allocations = 0 (queried = 1)
    \tchecked allocations reason = no host
    \tchecked allocations flags = 0x0
    \tlast exit code = 1

    \tsemaphores = {
    \t\tsuccessful exit => 0
    \t}

    \tresource coalition = {
    \t\tID = 9275
    \t\ttype = resource
    \t\tstate = active
    \t\tactive count = 1
    \t\tname = com.mattstack.daemon
    \t}

    \tjetsam coalition = {
    \t\tID = 9276
    \t\ttype = jetsam
    \t\tstate = active
    \t\tactive count = 1
    \t\tname = com.mattstack.daemon
    \t}

    \tspawn type = interactive (4)
    \tjetsam priority = 40
    \tjetsam memory limit (active) = (unlimited)
    \tjetsam memory limit (inactive) = (unlimited)
    \tjetsamproperties category = daemon
    \tsubmitted job. ignore execute allowed
    \tjetsam thread limit = 32
    \tcpumon = default
    \tjob state = running

    \tproperties = partial import | runatload | resolve program | has LWCR
    }
    """

    /// The refused-spawn state prod's daemon was left in on 2026-09-25,
    /// rebuilt from `healthy` with the four fields read off the broken job
    /// (its full print was not kept). Every pattern starts at "\n\t" so only
    /// top-level fields change, never the coalition blocks' copies.
    static let refusedSpawn = healthy
        .replacingOccurrences(of: "\n\tactive count = 1\n", with: "\n\tactive count = 0\n")
        .replacingOccurrences(of: "\n\tstate = running\n", with: "\n\tstate = not running\n")
        .replacingOccurrences(of: "\n\tpid = 28474\n", with: "\n")
        .replacingOccurrences(of: "\n\tlast exit code = 1\n", with: "\n\tlast exit code = 78: EX_CONFIG\n")
        .replacingOccurrences(of: "\n\tjob state = running\n", with: "\n\tjob state = spawn failed\n")
        .replacingOccurrences(of: "| has LWCR\n", with: "| needs LWCR update\n")

    /// A job that exited 1 on its own and is waiting out its throttle.
    static let crashedOnItsOwn = healthy
        .replacingOccurrences(of: "\n\tstate = running\n", with: "\n\tstate = not running\n")
        .replacingOccurrences(of: "\n\tpid = 28474\n", with: "\n")
        .replacingOccurrences(of: "\n\tjob state = running\n", with: "\n\tjob state = exited\n")

    static let notFound = "Bad request.\nCould not find service \"com.mattstack.daemon\" in domain for user gui: 501\n"
}
