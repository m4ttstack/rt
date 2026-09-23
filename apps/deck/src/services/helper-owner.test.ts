import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import {
  bundleHelperOwnsDeck,
  deckStartHint,
  prepareHelperBoot,
  retireHandAgent,
  runningDeckLabel,
  type Probe,
} from './helper-owner.ts';

const SMAPP_DEV = `gui/501/com.mattstack.deck.dev = {
\tactive count = 1
\tpath = (submitted by smd.340)
\ttype = Submitted
\tmanaged_by = com.apple.xpc.ServiceManagement
\tstate = running
}`;

const handAgent = (
  agents: string,
  pid = 4242
) => `gui/501/com.mattstack.deck = {
\tactive count = 1
\tpath = ${agents}/com.mattstack.deck.plist
\ttype = LaunchAgent
\tstate = running
\tpid = ${pid}
}`;

const NOT_LOADED = {
  code: 113,
  stdout: 'Could not find service "x" in domain for user gui: 501',
};

function probeOf(jobs: Record<string, string>): Probe & { asked: string[] } {
  const asked: string[] = [];
  const probe = async (argv: string[]) => {
    asked.push(argv.join(' '));
    const label = argv[2]!.split('/').pop()!;
    return label in jobs ? { code: 0, stdout: jobs[label]! } : NOT_LOADED;
  };
  return Object.assign(probe, { asked });
}

describe('bundleHelperOwnsDeck', () => {
  test('a deck running from a bundle is the helper, no launchd probe needed', async () => {
    const probe = probeOf({});

    expect(await bundleHelperOwnsDeck(probe, '/Applications/m.app')).toBe(true);
    expect(probe.asked).toEqual([]);
  });

  test('an SMAppService-submitted deck.dev job owns deck', async () => {
    const probe = probeOf({ 'com.mattstack.deck.dev': SMAPP_DEV });

    expect(await bundleHelperOwnsDeck(probe, null)).toBe(true);
  });

  test('the prod helper shares the bare label and still owns deck', async () => {
    const probe = probeOf({
      'com.mattstack.deck': SMAPP_DEV.replace('deck.dev', 'deck'),
    });

    expect(await bundleHelperOwnsDeck(probe, null)).toBe(true);
  });

  test('a hand-installed agent alone is not a bundle helper', async () => {
    const probe = probeOf({ 'com.mattstack.deck': handAgent('/u/Library') });

    expect(await bundleHelperOwnsDeck(probe, null)).toBe(false);
  });
});

describe('runningDeckLabel', () => {
  const devHelper = (pid?: number) =>
    SMAPP_DEV.replace(
      '\tstate = running\n',
      pid
        ? `\tstate = running\n\tpid = ${pid}\n`
        : '\tstate = spawn scheduled\n'
    );

  test('the dev helper serving as this pid is the running deck', async () => {
    const probe = probeOf({ 'com.mattstack.deck.dev': devHelper(900) });

    expect(await runningDeckLabel(probe, 900, 501)).toBe(
      'com.mattstack.deck.dev'
    );
  });

  test('a hand agent holding the ports beats a crash-looping helper with no pid', async () => {
    const probe = probeOf({
      'com.mattstack.deck.dev': devHelper(),
      'com.mattstack.deck': handAgent('/u/Library', 4242),
    });

    expect(await runningDeckLabel(probe, 4242, 501)).toBe('com.mattstack.deck');
  });

  test('without a pid to match, the first job launchd reports running wins', async () => {
    const probe = probeOf({
      'com.mattstack.deck.dev': devHelper(900),
      'com.mattstack.deck': handAgent('/u/Library', 4242),
    });

    expect(await runningDeckLabel(probe, null, 501)).toBe(
      'com.mattstack.deck.dev'
    );
  });

  test('nothing running under either label is null', async () => {
    const probe = probeOf({ 'com.mattstack.deck.dev': devHelper() });

    expect(await runningDeckLabel(probe, 900, 501)).toBeNull();
  });
});

describe('deckStartHint', () => {
  test('a helper-owned machine is told to use the app or kickstart the helper launchd reports', async () => {
    const probe = probeOf({ 'com.mattstack.deck.dev': SMAPP_DEV });

    const hint = await deckStartHint(probe, null, 501);

    expect(hint).toContain('mattstack app');
    expect(hint).toContain(
      '`launchctl kickstart -k gui/501/com.mattstack.deck.dev`'
    );
    expect(hint).not.toContain('deck setup');
  });

  test('a bundle process launchd reports no job for points at the app alone', async () => {
    const hint = await deckStartHint(probeOf({}), '/Applications/m.app', 501);

    expect(hint).toContain('mattstack app');
    expect(hint).not.toContain('launchctl');
    expect(hint).not.toContain('deck setup');
  });

  test('without a helper, deck serve and deck setup are still the way in', async () => {
    const probe = probeOf({ 'com.mattstack.deck': handAgent('/u/Library') });

    expect(await deckStartHint(probe, null, 501)).toBe(
      'Start it with `deck serve` or install it with `deck setup`.'
    );
  });
});

function agentsFixture() {
  const root = mkdtempSync(join(tmpdir(), 'deck-helper-owner-'));
  const agentsDir = join(root, 'LaunchAgents');
  const archiveDir = join(root, 'state');
  mkdirSync(agentsDir);
  mkdirSync(archiveDir);
  writeFileSync(join(agentsDir, 'com.mattstack.deck.plist'), '<plist/>');
  return { agentsDir, archiveDir };
}

/** A launchd whose bootout really unloads the job, unless told it fails. */
function launchdOf(
  jobs: Record<string, string>,
  opts: { bootoutSticks?: boolean } = {}
) {
  const ran: string[] = [];
  const probe = probeOf(jobs);
  const run = async (argv: string[]) => {
    ran.push(argv.join(' '));
    if (argv[1] === 'bootout' && opts.bootoutSticks !== false)
      delete jobs[argv[2]!.split('/').pop()!];
    return opts.bootoutSticks === false ? 5 : 0;
  };
  return { probe, run, ran };
}

describe('retireHandAgent', () => {
  test('boots out and archives a hand agent launchd loaded from LaunchAgents', async () => {
    const { agentsDir, archiveDir } = agentsFixture();
    const { probe, run, ran } = launchdOf({
      'com.mattstack.deck': handAgent(agentsDir),
    });

    const retired = await retireHandAgent({
      probe,
      run,
      agentsDir,
      archiveDir,
      uid: 501,
      selfPid: 1,
    });

    expect(retired).toBe(true);
    expect(ran).toEqual(['launchctl bootout gui/501/com.mattstack.deck']);
    expect(existsSync(join(agentsDir, 'com.mattstack.deck.plist'))).toBe(false);
    expect(
      existsSync(join(archiveDir, 'com.mattstack.deck.plist.retired'))
    ).toBe(true);
  });

  test('archives the hand plist but never boots out an SMAppService job holding the bare label', async () => {
    const { agentsDir, archiveDir } = agentsFixture();
    const { probe, run, ran } = launchdOf({
      'com.mattstack.deck': SMAPP_DEV.replace('deck.dev', 'deck'),
    });

    const retired = await retireHandAgent({
      probe,
      run,
      agentsDir,
      archiveDir,
      uid: 501,
      selfPid: 1,
    });

    expect(retired).toBe(true);
    expect(ran).toEqual([]);
    expect(existsSync(join(agentsDir, 'com.mattstack.deck.plist'))).toBe(false);
    expect(
      existsSync(join(archiveDir, 'com.mattstack.deck.plist.retired'))
    ).toBe(true);
  });

  test('archives a hand plist launchd has not loaded, booting nothing out', async () => {
    const { agentsDir, archiveDir } = agentsFixture();
    const { probe, run, ran } = launchdOf({});

    const retired = await retireHandAgent({
      probe,
      run,
      agentsDir,
      archiveDir,
      uid: 501,
      selfPid: 1,
    });

    expect(retired).toBe(true);
    expect(ran).toEqual([]);
    expect(existsSync(join(agentsDir, 'com.mattstack.deck.plist'))).toBe(false);
  });

  test('nothing to do without a hand plist or a hand-loaded job', async () => {
    const { agentsDir, archiveDir } = agentsFixture();
    rmSync(join(agentsDir, 'com.mattstack.deck.plist'));
    const { probe, run, ran } = launchdOf({});

    const retired = await retireHandAgent({
      probe,
      run,
      agentsDir,
      archiveDir,
      uid: 501,
      selfPid: 1,
    });

    expect(retired).toBe(false);
    expect(ran).toEqual([]);
  });

  test('never boots out the process it is running in', async () => {
    const { agentsDir, archiveDir } = agentsFixture();
    const { probe, run, ran } = launchdOf({
      'com.mattstack.deck': handAgent(agentsDir, 777),
    });

    const retired = await retireHandAgent({
      probe,
      run,
      agentsDir,
      archiveDir,
      uid: 501,
      selfPid: 777,
    });

    expect(retired).toBe(false);
    expect(ran).toEqual([]);
  });

  test('a bootout that leaves the agent loaded archives nothing', async () => {
    const { agentsDir, archiveDir } = agentsFixture();
    const { probe, run } = launchdOf(
      { 'com.mattstack.deck': handAgent(agentsDir) },
      { bootoutSticks: false }
    );

    const retired = await retireHandAgent({
      probe,
      run,
      agentsDir,
      archiveDir,
      uid: 501,
      selfPid: 1,
    });

    expect(retired).toBe(false);
    expect(existsSync(join(agentsDir, 'com.mattstack.deck.plist'))).toBe(true);
  });

  test('a trailing slash on the agents dir still matches', async () => {
    const { agentsDir, archiveDir } = agentsFixture();
    const { probe, run } = launchdOf({
      'com.mattstack.deck': handAgent(agentsDir),
    });

    const retired = await retireHandAgent({
      probe,
      run,
      agentsDir: `${agentsDir}/`,
      archiveDir,
      uid: 501,
      selfPid: 1,
    });

    expect(retired).toBe(true);
  });

  test('archives into a missing dir, never over an earlier retirement', async () => {
    const { agentsDir, archiveDir } = agentsFixture();
    const nested = join(archiveDir, 'not', 'yet');
    const { probe, run } = launchdOf({
      'com.mattstack.deck': handAgent(agentsDir),
    });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'com.mattstack.deck.plist.retired'), 'first');
    const fresh = join(archiveDir, 'fresh');

    await retireHandAgent({
      probe,
      run,
      agentsDir,
      archiveDir: nested,
      uid: 501,
      selfPid: 1,
    });
    writeFileSync(join(agentsDir, 'com.mattstack.deck.plist'), '<plist/>');
    const again = launchdOf({ 'com.mattstack.deck': handAgent(agentsDir) });
    await retireHandAgent({
      probe: again.probe,
      run: again.run,
      agentsDir,
      archiveDir: fresh,
      uid: 501,
      selfPid: 1,
    });

    expect(
      readFileSync(join(nested, 'com.mattstack.deck.plist.retired'), 'utf8')
    ).toBe('first');
    expect(readdirSync(nested)).toHaveLength(2);
    expect(existsSync(join(fresh, 'com.mattstack.deck.plist.retired'))).toBe(
      true
    );
  });
});

describe('prepareHelperBoot', () => {
  test('outside a bundle it neither touches PATH nor asks launchd', async () => {
    const probe = probeOf({});
    const env: Record<string, string | undefined> = { PATH: '/usr/bin' };

    await prepareHelperBoot({
      bundleRoot: null,
      env,
      retire: {
        probe,
        run: async () => 0,
        agentsDir: '/a',
        archiveDir: '/b',
        uid: 501,
        selfPid: 1,
      },
      log: () => {},
    });

    expect(env.PATH).toBe('/usr/bin');
    expect(probe.asked).toEqual([]);
  });

  test('as a helper it composes PATH and retires a stray hand agent', async () => {
    const { agentsDir, archiveDir } = agentsFixture();
    const launchd = launchdOf({ 'com.mattstack.deck': handAgent(agentsDir) });
    const env: Record<string, string | undefined> = { PATH: '/usr/bin' };

    await prepareHelperBoot({
      bundleRoot: '/Applications/m.app',
      env,
      compose: () => '/opt/homebrew/bin:/usr/bin',
      retire: {
        ...launchd,
        agentsDir,
        archiveDir,
        uid: 501,
        selfPid: 1,
      },
      log: () => {},
    });

    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin');
    expect(launchd.ran).toEqual([
      'launchctl bootout gui/501/com.mattstack.deck',
    ]);
  });

  test('a failed retirement is logged, never thrown', async () => {
    const logged: string[] = [];

    await prepareHelperBoot({
      bundleRoot: '/Applications/m.app',
      env: {},
      compose: () => '/usr/bin',
      retire: {
        probe: async () => {
          throw new Error('launchctl gone');
        },
        run: async () => 0,
        agentsDir: '/a',
        archiveDir: '/b',
        uid: 501,
        selfPid: 1,
      },
      log: (...args) => logged.push(args.join(' ')),
    });

    expect(logged.join('\n')).toContain('launchctl gone');
  });
});
