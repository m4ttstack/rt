import { draftFilePath, writeDraft } from "../src/draft-state.ts";

const [mrUrl, iidRaw, kind, ...bodyParts] = process.argv.slice(2);
const iid = Number(iidRaw);
const body = bodyParts.join(" ").trim();

if (!mrUrl || !Number.isFinite(iid) || !kind || !body) {
  console.error("usage: doctor-draft <mrUrl> <iid> <kind> <body...>");
  process.exit(1);
}

const path = draftFilePath(mrUrl, kind);
writeDraft(path, { mrUrl, iid, kind, body, status: "held" });
console.log(path);
