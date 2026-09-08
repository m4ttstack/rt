import { join, resolve } from 'path';
import { expect, test } from 'bun:test';

/** APP_ROOT is fixed at module load from the environment, so the override
    is observed through a child process rather than by re-importing. */
async function appRootWith(override: string): Promise<string> {
  const proc = Bun.spawn(
    [
      'bun',
      '-e',
      "import { APP_ROOT } from './src/app-root.ts'; console.log(APP_ROOT)",
    ],
    {
      cwd: join(import.meta.dir, '..', '..'),
      env: { ...process.env, BOARD_APP_ROOT: override },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

test('BOARD_APP_ROOT is normalized so it matches the root a pane derives from its state path', async () => {
  expect(await appRootWith('/tmp/board-root/')).toBe(
    resolve('/tmp/board-root')
  );
  expect(await appRootWith('/tmp//board-root/./')).toBe(
    resolve('/tmp/board-root')
  );
});
