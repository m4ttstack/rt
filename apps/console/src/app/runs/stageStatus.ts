import type { MantineColor } from '@mattstack/app-kit/core';

/**
 * rt's stage vocabulary, mapped once. The board's progress bar and the run
 * detail timeline both color by stage status, and two copies of this map are
 * how they come to disagree about a status one of them learned about.
 *
 * `redirected` is written by `rt runs stage-redirect` for the stage a run
 * turned back from: abandoned work, not failed work, so it reads muted
 * rather than as an alert. An unmapped status falls back at each call site.
 */
export const STAGE_STATUS_COLOR: Record<string, MantineColor> = {
  done: 'ok',
  failed: 'bad',
  running: 'accent',
  redirected: 'gray',
};
