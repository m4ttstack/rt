import { writeDoctorState, type DoctorStatus } from "../src/doctor-state.ts";

const VALID: DoctorStatus[] = ["queued", "diagnosing", "rebasing", "fixing", "watching", "done", "error"];

const [path, status, ...rest] = process.argv.slice(2);
const message = rest.join(" ").trim();

if (!path || !status || !VALID.includes(status as DoctorStatus)) {
  console.error(`usage: doctor-status <statePath> <${VALID.join("|")}> [message]`);
  process.exit(1);
}

writeDoctorState(path, { status: status as DoctorStatus, ...(message ? { message } : {}) });
