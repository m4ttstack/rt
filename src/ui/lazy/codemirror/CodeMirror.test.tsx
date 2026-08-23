import { createRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { CodeMirror } from './CodeMirror';
import type { CodeMirrorRef } from './CodeMirror.Base';

// `CodeMirror` is lazily loaded the same way `CodeHighlight` is (see its
// test), so every assertion here waits for the dynamic
// `import('./CodeMirror.Base')` to resolve first.
//
// jsdom doesn't implement `Range.getClientRects`/`getBoundingClientRect` at
// all (a known jsdom gap, see https://github.com/jsdom/jsdom/issues/3729).
// CodeMirror 6 measures the document's on-screen layout via `Range` on
// every view update -- not just real typing, *any* dispatch (including the
// programmatic ones this component's own `value`-sync effect makes) -- to
// position the cursor, gutters, etc., and throws without these. None of
// these tests assert real layout/geometry, so a zero-rect stub is enough to
// let that measurement pass complete instead of throwing.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function stubGetClientRects() {
    return {
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    } as unknown as DOMRectList;
  };
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function stubGetBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON() {},
    } as DOMRect;
  };
}

test('mounts and renders the initial value once the lazy import resolves', async () => {
  renderWithProviders(
    <CodeMirror value="const x = 1;" language="javascript" />
  );

  await waitFor(() => {
    expect(screen.getByTestId('codemirror-editor').textContent).toContain(
      'const x = 1;'
    );
  });

  const contentEditable = screen
    .getByTestId('codemirror-editor')
    .querySelector('[contenteditable="true"]');
  expect(contentEditable).toBeTruthy();
});

test('calls onChange with the new document text when the user types', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(<CodeMirror value="ab" onChange={onChange} />);

  const contentEditable = await waitFor(() => {
    const node = screen
      .getByTestId('codemirror-editor')
      .querySelector<HTMLElement>('[contenteditable="true"]');
    if (!node) {
      throw new Error('contenteditable not mounted yet');
    }
    return node;
  });

  await user.click(contentEditable);
  await user.keyboard('{End}');
  await user.keyboard('c');

  await waitFor(() => {
    expect(onChange).toHaveBeenCalled();
  });
  expect(onChange.mock.calls.at(-1)?.[0]).toContain('c');
});

test('does not call onChange when the controlled `value` prop changes externally', async () => {
  const onChange = vi.fn();
  const { rerender } = renderWithProviders(
    <CodeMirror value="one" onChange={onChange} />
  );

  await waitFor(() => {
    expect(screen.getByTestId('codemirror-editor').textContent).toContain(
      'one'
    );
  });

  rerender(<CodeMirror value="two" onChange={onChange} />);

  await waitFor(() => {
    expect(screen.getByTestId('codemirror-editor').textContent).toContain(
      'two'
    );
  });
  expect(onChange).not.toHaveBeenCalled();
});

test('mounts with the scheme-aware editor theme (kit CSS vars in the injected styles)', async () => {
  renderWithProviders(<CodeMirror value="x" />);

  await waitFor(() => {
    expect(screen.getByTestId('codemirror-editor').textContent).toContain('x');
  });

  // CodeMirror injects its theme via StyleModule <style> tags; the kit's
  // editorTheme references the scheme vars, so their presence proves the
  // theme (and with it the light/dark flag machinery) is wired in.
  const styleText = Array.from(document.querySelectorAll('style'))
    .map(tag => tag.textContent ?? '')
    .join('\n');
  expect(styleText).toContain('var(--ui-bg-4)');
  expect(styleText).toContain('var(--ui-bg-3)');
});

test('applies a custom extension passed via `extensions`', async () => {
  renderWithProviders(
    <CodeMirror
      value="x"
      extensions={[
        EditorView.editorAttributes.of({ 'data-custom-ext': 'yes' }),
      ]}
    />
  );

  await waitFor(() => {
    const cmEditor = screen
      .getByTestId('codemirror-editor')
      .querySelector('.cm-editor');
    expect(cmEditor?.getAttribute('data-custom-ext')).toBe('yes');
  });
});

test('calls onCreateEditor once with the view and initial state', async () => {
  const onCreateEditor = vi.fn();
  renderWithProviders(
    <CodeMirror value="const x = 1;" onCreateEditor={onCreateEditor} />
  );

  await waitFor(() => {
    expect(onCreateEditor).toHaveBeenCalledTimes(1);
  });
  const [view, state] = onCreateEditor.mock.calls[0];
  expect(view).toBeInstanceOf(EditorView);
  expect(state).toBeInstanceOf(EditorState);
  expect(state.doc.toString()).toBe('const x = 1;');
});

test('calls onUpdate on every editor update, alongside onChange', async () => {
  const user = userEvent.setup();
  const onUpdate = vi.fn();
  const onChange = vi.fn();
  renderWithProviders(
    <CodeMirror value="ab" onChange={onChange} onUpdate={onUpdate} />
  );

  const contentEditable = await waitFor(() => {
    const node = screen
      .getByTestId('codemirror-editor')
      .querySelector<HTMLElement>('[contenteditable="true"]');
    if (!node) {
      throw new Error('contenteditable not mounted yet');
    }
    return node;
  });

  const callsBeforeTyping = onUpdate.mock.calls.length;
  await user.click(contentEditable);
  await user.keyboard('{End}');
  await user.keyboard('c');

  await waitFor(() => {
    expect(onChange).toHaveBeenCalled();
  });
  expect(onUpdate.mock.calls.length).toBeGreaterThan(callsBeforeTyping);
  const lastUpdate = onUpdate.mock.calls.at(-1)?.[0];
  expect(lastUpdate?.state.doc.toString()).toContain('c');
});

test('exposes the live EditorView through the forwarded ref', async () => {
  const ref = createRef<CodeMirrorRef>();
  renderWithProviders(<CodeMirror ref={ref} value="const x = 1;" />);

  await waitFor(() => {
    expect(ref.current?.view).toBeInstanceOf(EditorView);
  });
  expect(ref.current?.view?.state.doc.toString()).toBe('const x = 1;');
});

test('an Extension `theme` prop replaces the auto scheme theme entirely', async () => {
  const customTheme = EditorView.theme({
    '&': { fontFamily: 'ui-custom-marker-font' },
  });
  renderWithProviders(<CodeMirror value="x" theme={customTheme} />);

  const cmEditor = await waitFor(() => {
    const node = screen
      .getByTestId('codemirror-editor')
      .querySelector('.cm-editor');
    if (!node) {
      throw new Error('.cm-editor not mounted yet');
    }
    return node;
  });

  // CodeMirror's `EditorView.theme()` adds a distinct generated class (a
  // `style-mod` hash, e.g. `ͼ14`) straight onto `.cm-editor` for each theme
  // extension. Scope the assertion to the rules for THIS element's own
  // classes -- the shared jsdom document accumulates every `<style>` tag
  // CodeMirror has ever injected across every test in this file (including
  // the kit's default `var(--ui-bg-4)` chrome from earlier tests), so
  // searching the whole document's style text would false-positive on
  // theme output left behind by unrelated renders.
  const styleModuleClasses = Array.from(cmEditor.classList).filter(cls =>
    cls.startsWith('ͼ')
  );
  const styleText = Array.from(document.querySelectorAll('style'))
    .map(tag => tag.textContent ?? '')
    .join('\n');
  const ownRules = styleModuleClasses
    .map(cls => styleText.match(new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`))?.[0])
    .filter(Boolean)
    .join(' ');

  expect(ownRules).toContain('ui-custom-marker-font');
  expect(ownRules).not.toContain('var(--ui-bg-4)');
});
