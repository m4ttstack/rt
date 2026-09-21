import { SlackLogo } from './icons.tsx';

/** The Slack squircle on the header filter button. `mono` paints it in
    currentColor, which the button's own active fill then inverts. The
    control states its own on/off through that fill, its label and
    `aria-pressed`, so the mark carries no state of its own. */
function SlackPostedMark({
  title,
  mono = false,
}: {
  title?: string;
  mono?: boolean;
}) {
  return (
    <span className="tui-slack-posted" title={title}>
      <SlackLogo mono={mono} />
    </span>
  );
}

export { SlackPostedMark };
