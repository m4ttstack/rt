# jq -r -n --slurpfile catalog <catalog.jq output> --slurpfile status <deck
#   /api/v1/status or null> --slurpfile launchd <{name: launchctl-print.jq}>
#   --slurpfile routes <~/.portless/routes.json or null>
#   --arg helpers <app>/Contents/Helpers --arg home <$HOME>
# Prints one "ok<TAB>msg" or "bad<TAB>msg" line per assertion.
def ok($m): "ok\t" + $m;
def bad($m): "bad\t" + $m;
def deck_label($n): "com.mattstack.deck." + $n;

($catalog[0] // {apps: [], tools: []}) as $cat
| ($status[0]) as $st
| ($launchd[0] // {}) as $ld
| ([($routes[0] // [])[]?.hostname]) as $hosts
| if ($cat.apps | length) == 0 then
    bad("deps.lock names no served apps: no helper row carries serve")
  elif ($st | type) != "object" or ($st.apps | type) != "array" then
    bad("deck /api/v1/status did not answer with an apps list")
  else
    (if $st.devMode == false then ok("deck reports the prod flavor (devMode false)")
     else bad("deck reports devMode \($st.devMode | tojson) inside the prod bundle") end),
    ( $cat.apps[] as $a
      | "\($helpers)/\($a.name)" as $bin
      | ([$st.apps[] | select(.name == $a.name)] | first) as $row
      | ($ld[$a.name] // {loaded: false}) as $job
      | if $a.status != "bundled" then
          bad("\($a.name): deps.lock serves it but its row is \($a.status), so this bundle does not ship it")
        elif $row == null then
          bad("\($a.name): no row in deck /api/v1/status (not registered, or no route)")
        else
          (if $row.managedBy == "rt" then ok("\($a.name): rt-managed")
           else bad("\($a.name): managedBy is \($row.managedBy | tojson), wanted \"rt\"") end),
          (if $row.health.ok == true then ok("\($a.name): healthy (HTTP \($row.health.status))")
           else bad("\($a.name): unhealthy: \($row.health | tojson)") end),
          ([$row.issues[]? | select(.source == "dev-link") | .message] as $dl
           | if ($dl | length) == 0 then ok("\($a.name): no dev-link issues")
             else bad("\($a.name): dev-link issue: \($dl | join("; "))") end),
          (if ($row.icon // null) != null then ok("\($a.name): advertises an icon")
           else bad("\($a.name): no icon on its deck status row (bundled identity missing)") end),
          (if ($hosts | index("\($a.name).mattstack")) != null then ok("\($a.name): routed as \($a.name).mattstack")
           else bad("\($a.name): no \($a.name).mattstack route in ~/.portless/routes.json") end),
          (if $job.loaded != true then
             bad("\($a.name): \(deck_label($a.name)) is not loaded in launchd")
           else
             (if $job.program == $bin then ok("\($a.name): argv0 is \($bin)")
              else bad("\($a.name): argv0 is \($job.program | tojson), wanted \($bin)") end),
             (if $job.argv == [$bin] + $a.args then ok("\($a.name): argv matches deps.lock serve.args")
              else bad("\($a.name): argv is \($job.argv | tojson), wanted \([$bin] + $a.args | tojson)") end),
             (if $job.cwd == "\($home)/.mattstack/\($a.name)" then ok("\($a.name): working directory \($job.cwd)")
              else bad("\($a.name): working directory is \($job.cwd | tojson), wanted \($home)/.mattstack/\($a.name)") end),
             (if $job.pid != null then ok("\($a.name): running (pid \($job.pid))")
              else bad("\($a.name): loaded but not running (last exit \($job.lastExit // "unknown"))") end)
           end)
        end ),
    ( [$cat.tools[] | select(($ld[.] // {loaded: false}).loaded == true)] as $served_tools
      | if ($served_tools | length) == 0 then
          ok("no deps.lock tool is loaded as a deck app (checked \($cat.tools | length))")
        else
          $served_tools[] | bad("\(deck_label(.)) is loaded, but deps.lock ships \(.) as a tool, never an app")
        end )
  end
