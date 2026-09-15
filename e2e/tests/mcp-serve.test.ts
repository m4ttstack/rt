/**
 * e2e: `rt mcp serve` over the COMPILED binary (RT_BINARY), not `bun run
 * cli.ts` -- this is the only path that exercises the module-registry thunk
 * for commands/mcp.ts and the bundled dynamic import of the MCP SDK, both of
 * which the source-run fallback masks.
 *
 * The server drains in-flight tools/call work on stdin EOF rather than
 * aborting it (see commands/mcp.ts), so teardown ends stdin and waits for a
 * real exit before falling back to a kill.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { createTestHome, RT_BINARY } from "../harness.ts";

async function waitForSocket(sockPath: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(sockPath)) {
    if (Date.now() > deadline) throw new Error(`daemon socket never appeared at ${sockPath}`);
    await Bun.sleep(100);
  }
}

/** Grab a free TCP port by binding port 0 and releasing it. */
function freePort(): number {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = srv.port;
  srv.stop(true);
  if (!port) throw new Error("failed to allocate a free port");
  return port;
}

let apiPort = 0;
const children: Array<ReturnType<typeof Bun.spawn>> = [];

function rtEnv(home: string, extraEnv: Record<string, string>): Record<string, string> {
  const bunDir = join(process.execPath, "..");
  return {
    HOME: home,
    PATH: `${join(RT_BINARY, "..")}:${bunDir}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`,
    TERM: "xterm-256color",
    RT_SKIP_SETUP: "1",
    CI: "true",
    RT_API_PORT: String(apiPort),
    RT_RUN_EMIT: "0", // no need for run-start to round-trip through the daemon here
    ...extraEnv,
  };
}

function runRt(args: string[], home: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn([RT_BINARY, ...args], {
    env: rtEnv(home, extraEnv),
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(proc);
  return proc;
}

/**
 * Same spawn as runRt, but for a child whose stdin the test drives directly
 * (here, the mcp serve child). `stdin: "pipe"` is written as a literal in
 * this call, not threaded through as a runtime parameter: Bun.spawn's `const
 * In` type parameter only narrows `proc.stdin` to `FileSink` when it infers a
 * single literal, and a variable typed as a union of stdin modes (even a
 * two-member one) makes it infer the union instead, which is what silently
 * turned proc.stdin into `number | FileSink | undefined` before.
 */
function runRtPiped(args: string[], home: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn([RT_BINARY, ...args], {
    env: rtEnv(home, extraEnv),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(proc);
  return proc;
}

async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, nl);
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) yield buf;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Speaks JSON-RPC over a child's stdio. Every non-empty stdout line is kept
 * in `rawLines` (parsed or not) so a test can assert stdout carried nothing
 * but JSON-RPC -- a stray console.log in the server would otherwise be
 * invisible to a client that only looks at matched responses.
 */
class McpClient {
  private nextId = 1;
  private pending = new Map<number, (res: JsonRpcResponse) => void>();
  readonly rawLines: string[] = [];
  private stderrChunks: string[] = [];

  constructor(private proc: ReturnType<typeof runRtPiped>) {
    void (async () => {
      for await (const line of lines(proc.stdout as unknown as ReadableStream<Uint8Array>)) {
        if (line.length === 0) continue;
        this.rawLines.push(line);
        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // recorded in rawLines regardless; the format assertion parses it itself
        }
        if (typeof msg.id === "number") this.pending.get(msg.id)?.(msg);
      }
    })();
    void (async () => {
      for await (const line of lines(proc.stderr as unknown as ReadableStream<Uint8Array>)) {
        this.stderrChunks.push(line);
      }
    })();
  }

  stderrText(): string {
    return this.stderrChunks.join("\n");
  }

  private send(msg: object): void {
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
    this.proc.stdin.flush();
  }

  notify(method: string, params?: object): void {
    this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  async request(method: string, params?: object, timeoutMs = 10_000): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const settled = new Promise<JsonRpcResponse>((resolve) => this.pending.set(id, resolve));
    this.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<JsonRpcResponse>((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `mcp serve: timed out waiting for "${method}" (id ${id})\n--- captured stderr ---\n${this.stderrText()}`,
      )), timeoutMs);
    });
    try {
      return await Promise.race([settled, timeout]);
    } finally {
      clearTimeout(timer);
      this.pending.delete(id);
    }
  }
}

const EXPECTED_TOOL_NAMES = [
  "chat_ack", "chat_claim", "chat_dm", "chat_post", "chat_release",
  "gate_answer", "gate_list",
  "herd_answer", "herd_ask", "herd_gates", "herd_report",
  "mr_reply_thread",
];

describe("rt mcp serve e2e", () => {
  let home: string;
  let cleanup: () => void;
  let daemon: ReturnType<typeof runRt>;

  beforeAll(async () => {
    apiPort = freePort();
    ({ path: home, cleanup } = createTestHome());
    daemon = runRt(["--daemon"], home);
    await waitForSocket(join(home, ".mattstack", "rt", "rt.sock"));
    if (daemon.exitCode !== null) {
      throw new Error(`daemon process exited (code ${daemon.exitCode}) right after creating its socket`);
    }
  });

  afterAll(async () => {
    for (const child of children) {
      try { child.kill(); } catch { /* already gone */ }
    }
    await Promise.all(children.map((c) => c.exited));
    cleanup();
  });

  test("initialize -> tools/list -> tools/call gate_list", async () => {
    const server = runRtPiped(["mcp", "serve"], home);
    const client = new McpClient(server);

    try {
      const init = await client.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "rt-e2e", version: "0.0.0" },
      });
      expect(init.error).toBeUndefined();
      const initResult = init.result as { serverInfo?: { name?: string } };
      expect(initResult.serverInfo?.name).toBe("mattstack");

      client.notify("notifications/initialized");

      const list = await client.request("tools/list", {});
      expect(list.error).toBeUndefined();
      const listResult = list.result as { tools: Array<{ name: string }> };
      const names = listResult.tools.map((t) => t.name).sort();
      expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());

      const call = await client.request("tools/call", { name: "gate_list", arguments: {} });
      expect(call.error).toBeUndefined();
      const callResult = call.result as { isError?: boolean; content: Array<{ type: string; text: string }> };
      expect(callResult.isError).toBeUndefined();
      const body = JSON.parse(callResult.content[0]!.text) as { gates: unknown[]; cursor: number };
      expect(Array.isArray(body.gates)).toBe(true);
      expect(body.gates).toEqual([]);
      expect(typeof body.cursor).toBe("number");

      // stdout must carry only JSON-RPC: a stray log line on stdout would
      // corrupt every client sharing the pipe, so every line gets checked,
      // not just the ones this test happened to match by id.
      for (const line of client.rawLines) {
        const parsed = JSON.parse(line);
        expect(parsed.jsonrpc).toBe("2.0");
      }
    } finally {
      try { server.stdin.end(); } catch { /* already closed */ }
      const exitedInTime = await Promise.race([
        server.exited.then(() => true),
        Bun.sleep(3000).then(() => false),
      ]);
      if (!exitedInTime) {
        try { server.kill(); } catch { /* already gone */ }
        await server.exited;
      }
    }
  }, 30_000);
});
