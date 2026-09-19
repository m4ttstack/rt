import { chmodSync, mkdtempSync, renameSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';

/** Deck ships from the apps monorepo: releases are app-prefixed tags on
    m4ttstack/apps, so "latest" must be resolved by tag prefix, never by the
    repo-wide latest release (that is whichever app released most recently). */
export const RELEASES_API =
  'https://api.github.com/repos/m4ttstack/apps/releases?per_page=30';

export function pickAsset(platform: string, arch: string): string {
  if (platform === 'darwin' && arch === 'arm64') return 'deck-darwin-arm64.tgz';
  if (platform === 'darwin' && arch === 'x64') return 'deck-darwin-x64.tgz';
  throw new Error(`no release asset for ${platform}-${arch}`);
}

interface ReleaseEntry {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

/** The API answers newest-first, so the first deck-v tag carrying the asset
    is the latest deck release. */
export function pickDeckAssetUrl(
  releases: ReleaseEntry[],
  asset: string
): { tag: string; url: string } | null {
  for (const r of releases) {
    if (!r.tag_name.startsWith('deck-v')) continue;
    const match = r.assets.find(a => a.name === asset);
    if (match) return { tag: r.tag_name, url: match.browser_download_url };
    return null;
  }
  return null;
}

/** Self-update: resolve the latest deck release on the monorepo, download its
    tarball, swap the extracted binary over the running one, then kickstart
    the service. */
export async function update(io: {
  out(s: string): void;
  err(s: string): void;
}): Promise<number> {
  if (basename(process.execPath).startsWith('bun')) {
    io.err('this is a checkout — update with git pull');
    return 1;
  }
  const asset = pickAsset(process.platform, process.arch);
  let releases: ReleaseEntry[];
  try {
    const res = await fetch(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      io.err(`release lookup failed: ${res.status}`);
      return 1;
    }
    releases = (await res.json()) as ReleaseEntry[];
  } catch (err) {
    io.err(`release lookup failed: ${String(err)}`);
    return 1;
  }
  const found = pickDeckAssetUrl(releases, asset);
  if (!found) {
    io.err(`no deck release with ${asset} found on m4ttstack/apps`);
    return 1;
  }
  io.out(`fetching ${found.tag} (${found.url}) ...`);
  let res: Response;
  try {
    res = await fetch(found.url, { redirect: 'follow' });
  } catch (err) {
    io.err(`download failed: ${String(err)}`);
    return 1;
  }
  if (!res.ok) {
    io.err(`download failed: ${res.status}`);
    return 1;
  }
  const scratch = mkdtempSync(join(tmpdir(), 'deck-update-'));
  try {
    const tarball = join(scratch, asset);
    await Bun.write(tarball, res);
    const untar = Bun.spawnSync([
      'tar',
      '-xzf',
      tarball,
      '-C',
      scratch,
      'deck',
    ]);
    if (untar.exitCode !== 0) {
      io.err(`extract failed: ${untar.stderr.toString().trim()}`);
      return 1;
    }
    const target = process.execPath;
    const tmp = target + '.new';
    renameSync(join(scratch, 'deck'), tmp);
    chmodSync(tmp, 0o755);
    renameSync(tmp, target); // atomic swap; the running process keeps its old image
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  io.out('updated. restarting the platform service ...');
  const { LaunchdManager } = await import('../services/launchd.ts');
  const { PLATFORM_LABEL } = await import('../services/manager.ts');
  await new LaunchdManager().kickstart(PLATFORM_LABEL);
  return 0;
}
