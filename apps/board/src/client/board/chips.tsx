import { SlackLogo } from './icons.tsx';

/** The Slack squircle with a ✓ overlay: the posted-in-slack mark on the
    header filter button. `mono` paints the squircle in currentColor (muted
    when off, page colour on the accent fill when on); `badge` defaults to
    the brand form only, so an off-state glyph carries no ✓. */
function SlackPostedMark({
  title,
  mono = false,
  badge = !mono,
}: {
  title?: string;
  mono?: boolean;
  badge?: boolean;
}) {
  return (
    <span className="tui-slack-posted" title={title}>
      <SlackLogo mono={mono} />
      {badge && (
        <span className="tui-slack-posted-check" aria-hidden>
          ✓
        </span>
      )}
    </span>
  );
}

export { SlackPostedMark };
