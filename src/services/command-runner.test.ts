import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startCommandRun, commandRunStatus, resetRuns } from "./command-runner.ts";

beforeEach(() => resetRuns());

function fakeSpawn(exit: Promise<number>) {
  const calls: Array<{ argv: string[]; cwd: string }> = [];
  const spawn = (argv: string[], opts: { cwd: string; stdout: number; stderr: number }) => {
    calls.push({ argv, cwd: opts.cwd });
    return { exited: exit };
  };
  return { spawn, calls };
}

test("spawns sh -c in the working directory and returns a runId", () => {
  const logDir = mkdtempSync(join(tmpdir(), "runlog-"));
  const { spawn, calls } = fakeSpawn(new Promise(() => {})); // never resolves = still running
  const r = startCommandRun({ name: "chat", cmd: "deploy", shell: "bun run deploy", workingDirectory: "/tmp/app" }, { spawn, logDir });
  expect(r.started).toBe(true);
  if (!r.started) throw new Error("unreachable");
  expect(calls[0].argv).toEqual(["sh", "-c", "bun run deploy"]);
  expect(calls[0].cwd).toBe("/tmp/app");
  expect(commandRunStatus("chat", r.runId)!.status).toBe("running");
});

test("refuses a second run while one is in flight (busy)", () => {
  const logDir = mkdtempSync(join(tmpdir(), "runlog-"));
  const { spawn } = fakeSpawn(new Promise(() => {}));
  const first = startCommandRun({ name: "chat", cmd: "deploy", shell: "s", workingDirectory: "/tmp" }, { spawn, logDir });
  expect(first.started).toBe(true);
  const second = startCommandRun({ name: "chat", cmd: "build", shell: "s", workingDirectory: "/tmp" }, { spawn, logDir });
  expect(second.started).toBe(false);
});

test("status flips to exited with the code when the process ends", async () => {
  const logDir = mkdtempSync(join(tmpdir(), "runlog-"));
  const { spawn } = fakeSpawn(Promise.resolve(0));
  const r = startCommandRun({ name: "chat", cmd: "deploy", shell: "s", workingDirectory: "/tmp" }, { spawn, logDir });
  if (!r.started) throw new Error("unreachable");
  await new Promise((res) => setTimeout(res, 10)); // let the exited handler run
  expect(commandRunStatus("chat", r.runId)).toEqual({ status: "exited", exitCode: 0 });
});

test("unknown run is null", () => {
  expect(commandRunStatus("chat", "nope")).toBeNull();
});
