import { readFileSync } from "fs";

const ROUTES_PATH = `${process.env.HOME}/.portless/routes.json`;
const DOMAIN_SUFFIX = ".m4tthew.dev";
const LOCALHOST_SUFFIX = ".localhost";
const PORT = 7950;

function loadRoutes(): Map<string, number> {
  const raw = JSON.parse(readFileSync(ROUTES_PATH, "utf-8")) as {
    hostname: string;
    port: number;
  }[];
  const map = new Map<string, number>();
  for (const r of raw) {
    const name = r.hostname.replace(LOCALHOST_SUFFIX, "");
    map.set(name, r.port);
  }
  return map;
}

let routes = loadRoutes();

// Reload routes periodically so new portless apps are picked up
setInterval(() => {
  try {
    routes = loadRoutes();
  } catch {}
}, 5000);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const host = req.headers.get("host") ?? "";
    const subdomain = host.replace(`:${PORT}`, "").replace(DOMAIN_SUFFIX, "");
    const targetPort = routes.get(subdomain);

    if (!targetPort) {
      return new Response(`No route for ${host}`, { status: 502 });
    }

    const url = new URL(req.url);
    url.hostname = "127.0.0.1";
    url.port = String(targetPort);
    url.protocol = "http:";

    const proxyReq = new Request(url.toString(), {
      method: req.method,
      headers: req.headers,
      body: req.body,
      redirect: "manual",
    });

    try {
      return await fetch(proxyReq);
    } catch {
      return new Response(`Upstream ${subdomain}.localhost:${targetPort} is down`, {
        status: 502,
      });
    }
  },
});

console.log(`Tunnel proxy listening on :${PORT}`);
