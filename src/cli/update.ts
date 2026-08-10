import { chmodSync, renameSync } from "fs";
import { basename } from "path";

export const REPO = "m4ttheweric/local-apps";

export function pickAsset(platform: string, arch: string): string {
  if (platform === "darwin" && arch === "arm64") return "local-darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "local-darwin-x64";
  throw new Error(`no release asset for ${platform}-${arch}`);
}

export function latestAssetUrl(asset: string): string {
  return `https://github.com/${REPO}/releases/latest/download/${asset}`;
}

/** Self-update: download over the running binary, then kickstart the service. */
export async function update(io: { out(s: string): void; err(s: string): void }): Promise<number> {
  if (basename(process.execPath).startsWith("bun")) {
    io.err("this is a checkout — update with git pull");
    return 1;
  }
  const asset = pickAsset(process.platform, process.arch);
  const url = latestAssetUrl(asset);
  io.out(`fetching ${url} ...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) { io.err(`download failed: ${res.status}`); return 1; }
  const target = process.execPath;
  const tmp = target + ".new";
  await Bun.write(tmp, res);
  chmodSync(tmp, 0o755);
  renameSync(tmp, target); // atomic swap; the running process keeps its old image
  io.out("updated. restarting the platform service ...");
  const { LaunchdManager } = await import("../services/launchd.ts");
  const { PLATFORM_LABEL } = await import("../services/manager.ts");
  await new LaunchdManager().kickstart(PLATFORM_LABEL);
  return 0;
}
