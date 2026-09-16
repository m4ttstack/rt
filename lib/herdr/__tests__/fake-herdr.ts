import type { Socket } from "bun";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/** A reply the fake returns as herdr's `{ error: { code, message } }` envelope. */
export class HerdrFakeError {
  constructor(public code: string, public message: string) {}
}

/**
 * A reply that leaves the connection open after the ack, as herdr does for
 * `events.subscribe`: `frames` follow the reply at once, and the fake's
 * `push` reaches the connection for as long as the client holds it.
 */
export class HerdrFakeStream {
  constructor(public result: unknown, public frames: unknown[] = []) {}
}

export type FakeHerdrHandler = (method: string, params: Record<string, unknown>) => unknown | Promise<unknown>;

export interface FakeHerdrRequest { method: string; params: Record<string, unknown> }

/**
 * herdr's wire contract, for tests: newline-delimited JSON over a unix
 * socket, one request per connection, the server closes after replying
 * unless the handler returned a HerdrFakeStream. The handler returns the
 * `result` object (with its `type` field), a HerdrFakeStream, or a
 * HerdrFakeError; a thrown error becomes `internal_error`.
 *
 * The socket gets its own mkdtemp directory rather than a counter: eight
 * suites import this helper, each with its own module instance and so its
 * own counter starting at zero, so a pid-and-counter name collides across
 * files. The loser's requests are answered by the winner's server, which
 * reads as available with nothing in `seen`.
 */
export function fakeHerdr(handler: FakeHerdrHandler) {
  const dir = mkdtempSync(join(tmpdir(), "fake-herdr-"));
  const sock = join(dir, "s.sock");
  const seen: Array<{ id: string; method: string; params: Record<string, unknown> }> = [];
  const buffers = new Map<object, string>();
  const streams = new Map<Socket<undefined>, FakeHerdrRequest>();
  const line = (frame: unknown) => JSON.stringify(frame) + "\n";
  const server = Bun.listen({
    unix: sock,
    socket: {
      data(socket, chunk) {
        const buf = (buffers.get(socket) ?? "") + chunk.toString();
        const nl = buf.indexOf("\n");
        if (nl < 0) {
          buffers.set(socket, buf);
          return;
        }
        buffers.delete(socket);
        const raw = buf.slice(0, nl);
        void (async () => {
          let id = "";
          let out: unknown;
          try {
            const req = JSON.parse(raw) as { id: string; method: string; params?: Record<string, unknown> };
            id = req.id;
            const params = req.params ?? {};
            seen.push({ id, method: req.method, params });
            out = await handler(req.method, params);
            if (out instanceof HerdrFakeStream) streams.set(socket, { method: req.method, params });
          } catch (err) {
            out = new HerdrFakeError("internal_error", err instanceof Error ? err.message : String(err));
          }
          if (out instanceof HerdrFakeError) {
            socket.write(line({ id, error: { code: out.code, message: out.message } }));
          } else if (out instanceof HerdrFakeStream) {
            socket.write(line({ id, result: out.result }));
            for (const frame of out.frames) socket.write(line(frame));
            return;
          } else {
            socket.write(line({ id, result: out }));
          }
          socket.end();
        })();
      },
      close(socket) {
        buffers.delete(socket);
        streams.delete(socket);
      },
      error() {},
    },
  });
  return {
    sock,
    seen,
    /** Writes one frame to every open stream whose request `match` accepts
        (all of them by default); returns how many received it. */
    push(frame: unknown, match: (req: FakeHerdrRequest) => boolean = () => true): number {
      let delivered = 0;
      for (const [socket, req] of streams) {
        if (!match(req)) continue;
        socket.write(line(frame));
        delivered += 1;
      }
      return delivered;
    },
    stop: () => {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
