import { describe, expect, test } from "bun:test";
import { signalEmoji, isSignalKind, parseAgentSignal, type AgentSignal } from "../agent-signal.ts";

const noLookup = (): number => {
  throw new Error("lookupIid should not be called on the /agent/status path");
};

/** notifyBoard posts `JSON.stringify(signal)` verbatim, so round-tripping an
    AgentSignal through JSON here is exactly the body the CLI sends -- these
    tests break if either side of the wire contract drifts. */
function wireBody(signal: AgentSignal): unknown {
  return JSON.parse(JSON.stringify(signal));
}

/** A workspace convention with a custom emoji, like the one this board grew up in. */
const EMOJI = { looking: "eyes", commented: "comment", approved: "white_check_mark" };

describe("signalEmoji", () => {
  test("a review that has started gets the looking emoji", () => {
    expect(signalEmoji("review", "reviewing", EMOJI)).toBe("eyes");
  });

  test("a review that landed as a comment gets the configured commented emoji", () => {
    expect(signalEmoji("review", "done", EMOJI, "comment")).toBe("comment");
    expect(signalEmoji("review", "done", { ...EMOJI, commented: "speech_balloon" }, "comment")).toBe("speech_balloon");
  });

  test("a review that landed as an approval gets the check", () => {
    expect(signalEmoji("review", "done", EMOJI, "approve")).toBe("white_check_mark");
  });

  test("done without an outcome signals nothing -- the human never answered the gate", () => {
    expect(signalEmoji("review", "done", EMOJI)).toBeNull();
    expect(signalEmoji("review", "done", EMOJI, "")).toBeNull();
  });

  test("an unknown outcome signals nothing rather than guessing", () => {
    expect(signalEmoji("review", "done", EMOJI, "approved")).toBeNull();
  });

  test("queued and error signal nothing", () => {
    expect(signalEmoji("review", "queued", EMOJI)).toBeNull();
    expect(signalEmoji("review", "error", EMOJI)).toBeNull();
  });

  test("respond and doctor have no policy yet", () => {
    expect(signalEmoji("respond", "drafting", EMOJI)).toBeNull();
    expect(signalEmoji("respond", "done", EMOJI)).toBeNull();
    expect(signalEmoji("doctor", "watching", EMOJI)).toBeNull();
    expect(signalEmoji("doctor", "done", EMOJI)).toBeNull();
  });
});

describe("isSignalKind", () => {
  test("accepts the three launch kinds", () => {
    expect(isSignalKind("review")).toBe(true);
    expect(isSignalKind("respond")).toBe(true);
    expect(isSignalKind("doctor")).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isSignalKind("reviews")).toBe(false);
    expect(isSignalKind("")).toBe(false);
    expect(isSignalKind(undefined)).toBe(false);
    expect(isSignalKind(3)).toBe(false);
  });
});

describe("parseAgentSignal", () => {
  test("accepts exactly the body notifyBoard posts for a reviewing signal (no outcome)", () => {
    const signal: AgentSignal = {
      mrUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821",
      iid: 4821,
      kind: "review",
      status: "reviewing",
    };
    const parsed = parseAgentSignal(wireBody(signal), "/agent/status", noLookup);
    expect(parsed?.mrUrl).toBe(signal.mrUrl);
    expect(parsed?.iid).toBe(signal.iid);
    expect(parsed?.kind).toBe(signal.kind);
    expect(parsed?.status).toBe(signal.status);
    expect(parsed?.outcome).toBeUndefined();
  });

  test("accepts exactly the body notifyBoard posts for a done+approve signal", () => {
    const signal: AgentSignal = {
      mrUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821",
      iid: 4821,
      kind: "review",
      status: "done",
      outcome: "approve",
    };
    const parsed = parseAgentSignal(wireBody(signal), "/agent/status", noLookup);
    expect(parsed?.mrUrl).toBe(signal.mrUrl);
    expect(parsed?.iid).toBe(signal.iid);
    expect(parsed?.kind).toBe(signal.kind);
    expect(parsed?.status).toBe(signal.status);
    expect(parsed?.outcome).toBe("approve");
  });

  test("a body with no outcome parses -- the common case for most transitions", () => {
    const parsed = parseAgentSignal(
      { mrUrl: "https://gitlab.com/acme/webapp/-/merge_requests/1", iid: 1, kind: "doctor", status: "rebasing" },
      "/agent/status",
      noLookup,
    );
    expect(parsed).toEqual({ mrUrl: "https://gitlab.com/acme/webapp/-/merge_requests/1", iid: 1, kind: "doctor", status: "rebasing", outcome: undefined });
  });

  const base = { mrUrl: "https://gitlab.com/acme/webapp/-/merge_requests/1", iid: 1, kind: "review", status: "reviewing" };

  test("rejects a missing or empty mrUrl", () => {
    expect(parseAgentSignal({ ...base, mrUrl: undefined }, "/agent/status", noLookup)).toBeNull();
    expect(parseAgentSignal({ ...base, mrUrl: "" }, "/agent/status", noLookup)).toBeNull();
  });

  test("rejects a non-string mrUrl", () => {
    expect(parseAgentSignal({ ...base, mrUrl: 123 }, "/agent/status", noLookup)).toBeNull();
  });

  test("rejects a kind that is not one of the three", () => {
    expect(parseAgentSignal({ ...base, kind: "deploy" }, "/agent/status", noLookup)).toBeNull();
  });

  test("rejects a missing or empty status", () => {
    expect(parseAgentSignal({ ...base, status: undefined }, "/agent/status", noLookup)).toBeNull();
    expect(parseAgentSignal({ ...base, status: "" }, "/agent/status", noLookup)).toBeNull();
  });

  test("rejects a non-numeric or non-finite iid", () => {
    expect(parseAgentSignal({ ...base, iid: "4821" }, "/agent/status", noLookup)).toBeNull();
    expect(parseAgentSignal({ ...base, iid: Infinity }, "/agent/status", noLookup)).toBeNull();
    expect(parseAgentSignal({ ...base, iid: NaN }, "/agent/status", noLookup)).toBeNull();
  });

  test("rejects a non-string outcome", () => {
    expect(parseAgentSignal({ ...base, outcome: 1 }, "/agent/status", noLookup)).toBeNull();
  });

  test("rejects a non-object body", () => {
    expect(parseAgentSignal(null, "/agent/status", noLookup)).toBeNull();
    expect(parseAgentSignal("nope", "/agent/status", noLookup)).toBeNull();
    expect(parseAgentSignal(42, "/agent/status", noLookup)).toBeNull();
  });

  test("the /review/outcome alias fills kind, status, and the iid from the injected lookup", () => {
    const lookup = (mrUrl: string): number => {
      expect(mrUrl).toBe("https://gitlab.com/acme/webapp/-/merge_requests/4821");
      return 4821;
    };
    const parsed = parseAgentSignal(
      { mrUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821", outcome: "comment" },
      "/review/outcome",
      lookup,
    );
    expect(parsed).toEqual({
      mrUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821",
      iid: 4821,
      kind: "review",
      status: "done",
      outcome: "comment",
    });
  });
});
