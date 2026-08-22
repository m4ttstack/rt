import { describe, expect, test } from "bun:test";
import { isLocalRequest } from "../local.ts";

function reqWithHost(host: string | null): Request {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  return new Request("http://x/data.json", { headers });
}

describe("isLocalRequest", () => {
  test("localhost host is local", () => {
    expect(isLocalRequest(reqWithHost("localhost:7930"))).toBe(true);
  });
  test("*.localhost host is local", () => {
    expect(isLocalRequest(reqWithHost("board.localhost"))).toBe(true);
  });
  test("*.mattstack host is local — the deck's brand TLD resolves only on this machine", () => {
    expect(isLocalRequest(reqWithHost("board.mattstack"))).toBe(true);
  });
  test("127.0.0.1 host is local", () => {
    expect(isLocalRequest(reqWithHost("127.0.0.1:7930"))).toBe(true);
  });
  test("public tunnel host is NOT local", () => {
    expect(isLocalRequest(reqWithHost("board.example.com"))).toBe(false);
  });
  test("missing host is NOT local", () => {
    expect(isLocalRequest(reqWithHost(null))).toBe(false);
  });
});
