import { expect, test } from "bun:test";
import { callerCswapAccount, listCswapAccounts, parseCswapList } from "../cswap.ts";

const CAPTURED = `
A newer version of claude-swap is available (0.25.0). You are using 0.23.0. Run \`cswap upgrade\` to update.
Accounts:
  1: alex@acme.test [Acme] (history: shared)
     ├ $$:    100%   $400.07 / $400.00
     ├ 5h:      0%
     ├ 7d:     40%   resets Aug 30 20:00  in 4d 0h
     └ Fable:  35%   resets Aug 30 20:00  in 4d 0h · 6m ago
  2: someone@example.com
     └ 5h:     12%
`;

test("parses slots, emails, aliases and a compact headroom summary", () => {
  expect(parseCswapList(CAPTURED)).toEqual([
    { slot: 1, email: "alex@acme.test", alias: "Acme", headroom: "5h 0% · 7d 40% · Fable 35%" },
    { slot: 2, email: "someone@example.com", headroom: "5h 12%" },
  ]);
});

test("a headroom label containing a colon still parses", () => {
  const text = `
Accounts:
  1: a@b.c
     ├ Sub:Label:  50%
`;
  expect(parseCswapList(text)).toEqual([{ slot: 1, email: "a@b.c", headroom: "Sub:Label 50%" }]);
});

test("an empty or unrelated output parses to no accounts", () => {
  expect(parseCswapList("")).toEqual([]);
  expect(parseCswapList("cswap: not found")).toEqual([]);
});

test("listCswapAccounts is empty when the binary is missing or fails", async () => {
  const missing = async () => ({ stdout: "", stderr: "", exitCode: -1 });
  expect(await listCswapAccounts(missing)).toEqual([]);
});

const LIST_JSON = JSON.stringify({
  schemaVersion: 1,
  activeAccountNumber: 1,
  accounts: [
    { number: 1, email: "alex@acme.test", active: true },
    { number: 4, email: "other@example.com", active: false },
  ],
});
const SESSION_DIR = "/home/x/.claude-swap-backup/sessions/1-alex_acme.test";

test("callerCswapAccount returns the active account a cswap-run caller sees", async () => {
  let seen: { argv: string[]; env?: Record<string, string | undefined> } | undefined;
  const exec = async (argv: string[], opts: { env?: Record<string, string | undefined> } = {}) => {
    seen = { argv, env: opts.env };
    return { stdout: LIST_JSON, stderr: "", exitCode: 0 };
  };
  expect(await callerCswapAccount({ CLAUDE_CONFIG_DIR: SESSION_DIR }, exec)).toBe("alex@acme.test");
  expect(seen!.argv.slice(1)).toEqual(["list", "--json"]);
  expect(seen!.env?.CLAUDE_CONFIG_DIR).toBe(SESSION_DIR);
});

test("callerCswapAccount is undefined for a default-profile caller, without spawning cswap", async () => {
  let calls = 0;
  const exec = async () => { calls++; return { stdout: LIST_JSON, stderr: "", exitCode: 0 }; };
  expect(await callerCswapAccount({}, exec)).toBeUndefined();
  expect(calls).toBe(0);
});

test("callerCswapAccount is undefined when cswap fails or reports no active account", async () => {
  const env = { CLAUDE_CONFIG_DIR: SESSION_DIR };
  expect(await callerCswapAccount(env, async () => ({ stdout: "", stderr: "", exitCode: 1 }))).toBeUndefined();
  expect(await callerCswapAccount(env, async () => ({ stdout: "not json", stderr: "", exitCode: 0 }))).toBeUndefined();
  const none = JSON.stringify({ activeAccountNumber: null, accounts: [] });
  expect(await callerCswapAccount(env, async () => ({ stdout: none, stderr: "", exitCode: 0 }))).toBeUndefined();
});
