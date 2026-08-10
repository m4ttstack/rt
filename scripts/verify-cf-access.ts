// scripts/verify-cf-access.ts
// LIVE gate for the access-tier pillar. Run BY MATT:
//   CF_TOKEN=… CF_ZONE=… CF_DOMAIN=yourdomain.com bun run scripts/verify-cf-access.ts
// Creates a scratch Access app + only-me policy on a hostname that serves
// nothing, verifies Cloudflare answers the gate (302 to the Access login),
// then deletes everything it created. Prints PASS/FAIL and every id it touched.
import { CfAccess } from "../src/edge/access.ts";

const token = process.env.CF_TOKEN;
const zoneId = process.env.CF_ZONE;
const domain = process.env.CF_DOMAIN;
if (!token || !zoneId || !domain) {
  console.error("CF_TOKEN, CF_ZONE, CF_DOMAIN are required. Run this yourself — the token never goes through an agent.");
  process.exit(2);
}

const host = `local-scratch-${Date.now()}.${domain}`;
const cf = new CfAccess({ token, zoneId });

let failed = false;
try {
  console.log(`creating scratch Access app for ${host} …`);
  await cf.sync("local-scratch", host, { tier: "only-me", email: "verify@local.invalid" });

  // The gate answers at the edge even though nothing serves the hostname:
  // an Access-protected host 302s to the team's cloudflareaccess.com login.
  const res = await fetch(`https://${host}/`, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  const gated = res.status >= 300 && res.status < 400 && location.includes("cloudflareaccess.com");
  console.log(`edge answered ${res.status}, location: ${location || "(none)"}`);
  if (!gated) {
    failed = true;
    console.error("FAIL: the hostname did not answer with an Access login redirect.");
    console.error("If DNS for the wildcard is not in place yet, run this after Task 4.4's bind on the real zone.");
  }
} catch (err) {
  failed = true;
  console.error("FAIL:", err);
} finally {
  console.log("tearing down the scratch Access app …");
  try { await cf.remove(host); console.log("teardown clean."); }
  catch (err) { console.error("TEARDOWN FAILED — remove it in the CF dashboard:", host, err); failed = true; }
}
console.log(failed ? "RESULT: FAIL" : "RESULT: PASS — token scope is sufficient for Access apps + policies.");
process.exit(failed ? 1 : 0);
