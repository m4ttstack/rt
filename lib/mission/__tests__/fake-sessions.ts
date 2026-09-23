import type { SessionIntent } from "../../ui/protocol.ts";
import type { SessionEnd, SessionHandle } from "../../ui/spawn.ts";
import type { MissionModel } from "../model.ts";

/** Replays a fixed intent list, then ends the stream (mirrors lib/runner/__tests__/runner.test.ts). */
export class FakeSession implements SessionHandle {
  pushed: MissionModel[] = [];
  private queue: SessionIntent[];
  exited: Promise<number>;
  private finish!: (code: number) => void;
  constructor(intents: SessionIntent[], private endResult: SessionEnd = { reason: "closed", code: 0 }) {
    this.queue = [...intents];
    this.exited = new Promise((r) => { this.finish = r; });
  }
  get intents(): AsyncIterable<SessionIntent> {
    const self = this;
    return { [Symbol.asyncIterator]() { return { next: () => self.next() }; } };
  }
  private next(): Promise<IteratorResult<SessionIntent>> {
    const it = this.queue.shift();
    if (it) return Promise.resolve({ value: it, done: false });
    return Promise.resolve({ value: undefined as never, done: true });
  }
  push(m: unknown): void { this.pushed.push(m as MissionModel); }
  async close(): Promise<SessionEnd> {
    this.finish(this.endResult.code);
    return this.endResult;
  }
}

/** Intents arrive on demand via `send`, so a test can drive the driver mid-session. */
export class QueueSession implements SessionHandle {
  pushed: MissionModel[] = [];
  private queue: SessionIntent[] = [];
  private waiter: ((v: IteratorResult<SessionIntent>) => void) | null = null;
  exited: Promise<number>;
  private finish!: (code: number) => void;
  constructor(private endResult: SessionEnd = { reason: "closed", code: 0 }) {
    this.exited = new Promise((r) => { this.finish = r; });
  }
  get intents(): AsyncIterable<SessionIntent> {
    const self = this;
    return { [Symbol.asyncIterator]() { return { next: () => self.next() }; } };
  }
  private next(): Promise<IteratorResult<SessionIntent>> {
    const it = this.queue.shift();
    if (it) return Promise.resolve({ value: it, done: false });
    return new Promise((resolve) => { this.waiter = resolve; });
  }
  send(i: SessionIntent): void {
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w({ value: i, done: false });
    } else {
      this.queue.push(i);
    }
  }
  push(m: unknown): void { this.pushed.push(m as MissionModel); }
  async close(): Promise<SessionEnd> {
    this.finish(this.endResult.code);
    return this.endResult;
  }
}

export async function flushMicrotasks(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
