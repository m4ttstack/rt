import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { FIXTURES, JQ_DIR, runJq } from "./jq.ts";

const PARSER = join(JQ_DIR, "launchctl-print.jq");
const parse = (text: string) => JSON.parse(runJq(["-R", "-s", "-c", "-f", PARSER], text));
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("launchctl-print.jq", () => {
  test("a running deck-written LaunchAgent: program, argv, working directory, pid", () => {
    expect(parse(fixture("launchctl-print-chat.txt"))).toEqual({
      loaded: true,
      program: "/Applications/mattstack.app/Contents/Helpers/chat",
      argv: ["/Applications/mattstack.app/Contents/Helpers/chat"],
      cwd: "/Users/tester/.mattstack/chat",
      pid: 17594,
      lastExit: null,
    });
  });

  test("every argument line is kept in order, and nested environment blocks never leak in", () => {
    const job = parse(fixture("launchctl-print-args.txt"));
    expect(job.argv).toEqual(["/Users/tester/.bun/bin/bun", "server/index.ts"]);
    expect(job.cwd).toBe("/Users/tester/Documents/GitHub/mattari/apps/api");
    expect(job.pid).toBe(3246);
    expect(job.lastExit).toBe("(never exited)");
  });

  test("an unknown label reads as not loaded", () => {
    expect(parse(fixture("launchctl-print-missing.txt"))).toEqual({
      loaded: false, program: null, argv: [], cwd: null, pid: null, lastExit: null,
    });
  });

  test("empty output reads as not loaded rather than erroring", () => {
    expect(parse("").loaded).toBe(false);
  });

  // served-apps.sh captures stderr with stdout, so a warning can land ahead of
  // the header, and a loaded tool read as unloaded would pass the tool check.
  test("a line ahead of the header does not hide a loaded job", () => {
    const job = parse(`launchctl: a warning\n${fixture("launchctl-print-chat.txt")}`);
    expect(job.loaded).toBe(true);
    expect(job.pid).toBe(17594);
  });

  // Derived from the chat capture: the shape launchd prints for a job that
  // refused to spawn (exit 78) and is waiting to retry, with no pid line.
  test("a loaded job with no pid keeps its last exit code", () => {
    const refused = fixture("launchctl-print-chat.txt")
      .replace(/\n\tpid = \d+\n/, "\n")
      .replace("\tstate = running", "\tstate = spawn scheduled")
      .replace("\tlast terminating signal = Terminated: 15", "\tlast exit code = 78: EX_CONFIG");
    const job = parse(refused);
    expect(job.loaded).toBe(true);
    expect(job.pid).toBeNull();
    expect(job.lastExit).toBe("78: EX_CONFIG");
  });
});
