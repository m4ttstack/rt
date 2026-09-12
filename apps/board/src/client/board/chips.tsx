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
  const fill = (brand: string) => (mono ? 'currentColor' : brand);
  return (
    <span className="tui-slack-posted" title={title}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
        <path
          fill={fill('#E01E5A')}
          d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 0 1 4 0v5a2 2 0 1 1-4 0v-5Z"
        />
        <path
          fill={fill('#36C5F0')}
          d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 0 1 0 4H4a2 2 0 1 1 0-4h5Z"
        />
        <path
          fill={fill('#2EB67D')}
          d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 0 1-4 0V4a2 2 0 1 1 4 0v5Z"
        />
        <path
          fill={fill('#ECB22E')}
          d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 0 1 0-4h5a2 2 0 1 1 0 4h-5Z"
        />
      </svg>
      {badge && (
        <span className="tui-slack-posted-check" aria-hidden>
          ✓
        </span>
      )}
    </span>
  );
}

export { SlackPostedMark };
