import { eventsEmit, eventsHead, eventsList, eventsWait } from "@mattstack/rt-client";
import { gateAnswer, gateOpen, gateWait, type GateVerbIo } from "../src/gates/verbs.ts";

const io: GateVerbIo = { eventsEmit, eventsWait, eventsList, eventsHead, now: () => Date.now() };

/** Reads a `--flag value` pair out of argv; `--flag=value` also works. */
function flag(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

const [verb, statePath, ...rest] = process.argv.slice(2);

try {
  if (verb === "open") {
    const questions = flag(rest, "--questions");
    if (!statePath || !questions) throw new Error("usage: gate open <state> --questions <json>");
    const gateId = await gateOpen(statePath, questions, io);
    console.log(gateId);
  } else if (verb === "wait") {
    if (!statePath) throw new Error("usage: gate wait <state>");
    const result = await gateWait(statePath, io);
    console.log(JSON.stringify(result));
  } else if (verb === "answer") {
    const answers = flag(rest, "--answers");
    const by = flag(rest, "--by");
    if (!statePath || !answers || by !== "pane") throw new Error("usage: gate answer <state> --answers <json> --by pane");
    await gateAnswer(statePath, answers, "pane", io);
  } else {
    throw new Error(`usage: gate <open|wait|answer> <state> ...`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
