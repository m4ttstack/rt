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
