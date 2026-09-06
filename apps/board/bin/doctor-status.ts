import { writeDoctorState, type DoctorStatus } from "../src/doctor-state.ts";
import { notifyBoard } from "../src/board-notify.ts";

const VALID: DoctorStatus[] = ["queued", "diagnosing", "rebasing", "fixing", "watching", "done", "error"];

const [path, status, ...rest] = process.argv.slice(2);
const message = rest.join(" ").trim();

if (!path || !status || !VALID.includes(status as DoctorStatus)) {
  console.error(`usage: doctor-status <statePath> <${VALID.join("|")}> [message]`);
  process.exit(1);
}

const state = writeDoctorState(path, { status: status as DoctorStatus, ...(message ? { message } : {}) });

await notifyBoard({ mrUrl: state.mrUrl, iid: state.iid, kind: "doctor", status });

// AUTO doctors leave a full audit trail (spec §6: one line per autonomous
// action). The pane reports each action as a status write whose message names
// it (see the wrapper contract), so mirroring every transition of an
// origin-auto doctor into the JSONL covers actions and outcomes alike.
if (state.origin === "auto") {
  try {
    const { appendAudit } = await import("../src/triage/audit.ts");
    appendAudit({ ts: Date.now(), mrUrl: state.mrUrl, iid: state.iid, event: "doctor-status", action: status, outcome: state.message });
  } catch (err) {
    console.error(`audit append failed: ${err instanceof Error ? err.message : err}`);
  }
}

// Escalation is the one loud moment (spec §3): an AUTO doctor hitting `error`
// pushes a one-line summary of the diagnosis to the tray (the full text stays
// in the state file and audit log). Manual doctors stay quiet -- the human
// launched that pane and is watching its badge.
if (status === "error" && state.origin === "auto") {
  try {
    const { loadTriageConfig } = await import("../src/triage/config.ts");
    const { escalationBody, notifyEscalation } = await import("../src/triage/notify.ts");
    await notifyEscalation(`doctor stuck on !${state.iid}`, escalationBody(state.message ?? "escalated without a message"), loadTriageConfig().notify);
  } catch (err) {
    console.error(`escalation notify failed: ${err instanceof Error ? err.message : err}`);
  }
}
