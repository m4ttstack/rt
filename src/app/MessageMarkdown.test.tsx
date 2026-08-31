import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';

import { MessageMarkdown } from './MessageMarkdown';

function render(body: string, mentions: string[] = [], humanHandle?: string) {
  return renderWithProviders(
    <div data-testid="body">
      <MessageMarkdown
        body={body}
        mentions={mentions}
        humanHandle={humanHandle}
      />
    </div>
  );
}

test('paragraphs, headings, lists, a table, a quote and a rule render as their tags', () => {
  render(
    '# One\n\n## Two\n\n#### Deep\n\npara one\n\npara two\n\n- a\n- b\n  - nested\n\n1. first\n2. second\n\n| k | v |\n| --- | --- |\n| url | where |\n\n> quoted\n\n---\n\n- [x] done\n- [ ] todo'
  );
  const body = screen.getByTestId('body');
  expect(body.querySelector('h1')).toHaveTextContent('One');
  expect(body.querySelector('h2')).toHaveTextContent('Two');
  expect(body.querySelector('h3')).toHaveTextContent('Deep');
  expect(body.querySelectorAll('h4')).toHaveLength(0);
  expect(body.querySelectorAll(':scope > p')).toHaveLength(2);
  expect(body.querySelectorAll('ul > li')).toHaveLength(5);
  expect(body.querySelector('ul ul > li')).toHaveTextContent('nested');
  expect(body.querySelectorAll('ol > li')).toHaveLength(2);
  expect(body.querySelector('table th')).toHaveTextContent('k');
  expect(body.querySelector('table td')).toHaveTextContent('url');
  expect(body.querySelector('table')!.parentElement!.className).toContain(
    'tbl'
  );
  expect(body.querySelector('blockquote')).toHaveTextContent('quoted');
  expect(body.querySelector('hr')).toBeInTheDocument();
  const boxes = body.querySelectorAll('input[type="checkbox"]');
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toBeChecked();
  expect(boxes[0]).toBeDisabled();
});

test('inline forms: bold, italic, strikethrough, inline code, bare and written links', () => {
  render(
    'see **bold** and *soft* and ~~gone~~ and `make_icon_swift` at http://x.test/a_b_c or [the spec](https://x.test/spec)'
  );
  const body = screen.getByTestId('body');
  expect(body.querySelector('strong')).toHaveTextContent('bold');
  expect(body.querySelector('em')).toHaveTextContent('soft');
  expect(body.querySelector('del')).toHaveTextContent('gone');
  expect(body.querySelector('code')).toHaveTextContent('make_icon_swift');
  const bare = screen.getByRole('link', { name: 'http://x.test/a_b_c' });
  expect(bare).toHaveAttribute('href', 'http://x.test/a_b_c');
  expect(bare).toHaveAttribute('target', '_blank');
  expect(bare).toHaveAttribute('rel', 'noreferrer');
  expect(screen.getByRole('link', { name: 'the spec' })).toHaveAttribute(
    'href',
    'https://x.test/spec'
  );
});

test('raw HTML never renders, an unsafe link loses its href, an image is its alt text', () => {
  render(
    // <script> stays after "after" on the same line, not its own
    // blank-line-separated paragraph: that keeps it inline HTML (remark
    // splits <script>, "alert(1)" and </script> into three sibling nodes,
    // so "alert(1)" survives as its own text node) rather than a
    // CommonMark HTML *block* (which would swallow tag and text as one
    // opaque node skipHtml drops wholesale, "alert(1)" included).
    'before <b>bold</b> after <script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![the failing step](https://x.test/shot.png)'
  );
  const body = screen.getByTestId('body');
  expect(body.querySelector('b')).toBeNull();
  expect(body.querySelector('script')).toBeNull();
  expect(body).toHaveTextContent('before bold after');
  // `skipHtml` drops the `<script>`/`</script>` tag syntax but not the text
  // between them: remark parses tags and inner text as separate nodes, and
  // the surviving text renders as an inert string, never a script element.
  expect(body).toHaveTextContent('alert(1)');
  const badLink = screen.getByText('bad');
  expect(badLink).toBeTruthy();
  expect(badLink.getAttribute('href') ?? '').toBe('');
  expect(body.querySelector('img')).toBeNull();
  expect(
    screen.getByRole('link', { name: 'the failing step' })
  ).toHaveAttribute('href', 'https://x.test/shot.png');
});

test('a fenced block renders through CodeBlock with its language and text', async () => {
  render('run:\n\n```sh\necho one\necho two\n```\n\ndone');
  // `code-block` is the CodeBlock's outer Paper, which sits outside
  // CodeHighlight's own lazy-load Suspense boundary: it mounts (with the
  // loader fallback inside) before the highlighted text does, so
  // `findByTestId` alone resolves too early. The content needs its own wait.
  const block = await screen.findByTestId('code-block');
  await waitFor(() => expect(block).toHaveTextContent('echo one'));
  expect(block).toHaveTextContent('echo two');
  expect(screen.getByTestId('body').querySelectorAll('pre')).toHaveLength(1);
});

test('mentions: only listed handles, never inside code, the human washed', () => {
  render('`@matt` and @matt and @fred and @matthew', ['matt'], 'matt');
  const mentions = screen
    .getByTestId('body')
    .querySelectorAll('[data-mention]');
  expect(mentions).toHaveLength(1);
  expect(mentions[0]).toHaveTextContent('@matt');
  expect(mentions[0]).toHaveAttribute('data-me', 'true');
  expect(screen.getByText('@fred', { exact: false })).toBeInTheDocument();
  render('@fred ping', ['fred'], 'matt');
  const fred = screen
    .getAllByTestId('body')[1]!
    .querySelector('[data-mention]')!;
  expect(fred).toHaveAttribute('data-mention', 'fred');
  expect(fred).not.toHaveAttribute('data-me');
});
