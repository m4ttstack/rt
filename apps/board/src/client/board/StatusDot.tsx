import { StatusDot as KitStatusDot } from '@mattstack/tui-kit';
import type { BoardMR } from '../../data.ts';
import { statusReasons } from './row-status.ts';

/** Maps the MR's blockers onto the kit dot's intent and its reasons onto
    the tip. */
function StatusDot({ mr }: { mr: BoardMR }) {
  const b = mr.blockers;
  const intent = !b.any
    ? 'ok'
    : b.hasConflicts || b.pipelineFailing
      ? 'bad'
      : 'warn';
  return <KitStatusDot intent={intent} tip={statusReasons(mr)} />;
}

export { StatusDot };
