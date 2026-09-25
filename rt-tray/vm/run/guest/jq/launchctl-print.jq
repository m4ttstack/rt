# Input: `launchctl print gui/<uid>/<label>` read raw (jq -R -s).
# Top-level keys sit one tab deep and nested blocks (environment, coalitions)
# two deep, so a one-tab prefix match never reads a nested key.
split("\n") as $lines
| def top($k):
    ($lines | map(select(startswith("\t" + $k + " = "))) | first)
    | if . == null then null else ltrimstr("\t" + $k + " = ") end;
  def argv:
    ($lines | index("\targuments = {")) as $i
    | if $i == null then []
      else $lines[$i + 1:] as $rest
        | ($rest | index("\t}")) as $j
        | $rest[: ($j // ($rest | length))] | map(ltrimstr("\t\t"))
      end;
  { loaded: (($lines[0] // "") | endswith(" = {")),
    program: top("program"),
    argv: argv,
    cwd: top("working directory"),
    pid: (top("pid") | if . == null then null else tonumber end),
    lastExit: top("last exit code") }
