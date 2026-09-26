import { createRef } from 'react';
import { highlightingFor } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  renderWithProviders,
  setPrefersColorScheme,
} from '@mattstack/app-kit/test-utils';
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

test('jsonCheck underlines schema issues, and a changed checker re-lints', async () => {
  const { forEachDiagnostic, forceLinting } = await import('@codemirror/lint');
  const ref = createRef<CodeMirrorRef>();
  const check = (value: unknown) =>
    Array.isArray(value) && typeof value[0] === 'number'
      ? [{ path: [0], message: 'expected string, got number' }]
      : [];
  const { rerender } = renderWithProviders(
    <CodeMirror
      ref={ref}
      value="[1]"
      language="json"
      jsonSchema={{ type: 'array', items: { type: 'string' } }}
      jsonCheck={check}
    />
  );
  await waitFor(() => expect(ref.current?.view).toBeTruthy());
  const view = ref.current!.view!;
  forceLinting(view);
  await waitFor(() => {
    const found: string[] = [];
    forEachDiagnostic(view.state, d => found.push(d.message));
    expect(found).toEqual(['expected string, got number']);
  });

  const otherCheck = () => [{ path: [0], message: 'a different issue' }];
  rerender(
    <CodeMirror
      ref={ref}
      value="[1]"
      language="json"
      jsonSchema={{ type: 'array', items: { type: 'string' } }}
      jsonCheck={otherCheck}
    />
  );
  // The linter only re-runs on a real document change (or its own idle
  // delay) -- a rerender alone doesn't touch CodeMirror's EditorState, so
  // this edit is what proves the new checker (read through a ref, not
  // rebuilt into the extension) takes effect on the next lint.
  view.dispatch({ changes: { from: 1, to: 2, insert: '2' } });
  forceLinting(view);
  await waitFor(() => {
    const found: string[] = [];
    forEachDiagnostic(view.state, d => found.push(d.message));
    expect(found).toEqual(['a different issue']);
  });
});

test('JSON property names, strings, numbers and booleans read through kit role tokens, not the red-string CodeMirror default', async () => {
  const ref = createRef<CodeMirrorRef>();
  renderWithProviders(
    <CodeMirror
      ref={ref}
      value={'{"name": "value", "count": 1, "flag": true}'}
      language="json"
    />
  );
  await waitFor(() => expect(ref.current?.view).toBeTruthy());
  const view = ref.current!.view!;

  const propertyClass = highlightingFor(view.state, [tags.propertyName]);
  const stringClass = highlightingFor(view.state, [tags.string]);
  expect(propertyClass).toBeTruthy();
  expect(stringClass).toBeTruthy();

  // Proves the classes aren't merely defined but actually painted onto the
  // rendered tokens.
  expect(
    view.dom.querySelector(`.${propertyClass!.split(' ')[0]}`)
  ).toBeTruthy();
  expect(view.dom.querySelector(`.${stringClass!.split(' ')[0]}`)).toBeTruthy();

  const styleText = Array.from(document.querySelectorAll('style'))
    .map(tag => tag.textContent ?? '')
    .join('\n');
  expect(styleText).toContain('var(--tk-text-accent)');
  expect(styleText).toContain('var(--tk-text-cyan)');
  expect(styleText).toContain('var(--tk-text-gold)');
  expect(styleText).toContain('var(--tk-text-purple)');
});

// Finds the CSS rule for the first class in a (possibly multi-class)
// highlighter class string, from every <style> tag CodeMirror has injected
// -- `highlightingFor` alone isn't proof of THIS style: CodeMirror's
// fallback `defaultHighlightStyle` (installed by `basicSetup` with
// `{fallback: true}`) answers the same query when no non-fallback
// highlighter is configured, so the class alone doesn't distinguish "the
// kit's role-token style is wired in" from "only the CodeMirror default is".
function ruleFor(cls: string): string {
  const className = cls.split(' ')[0]!;
  const styleText = Array.from(document.querySelectorAll('style'))
    .map(tag => tag.textContent ?? '')
    .join('\n');
  return (
    styleText.match(new RegExp(`\\.${className}\\s*\\{[^}]*\\}`))?.[0] ?? ''
  );
}

test('the kit highlight style (not the CodeMirror default) is installed for both the light and dark theme compartment configuration', async () => {
  const lightRef = createRef<CodeMirrorRef>();
  const { unmount } = renderWithProviders(
    <CodeMirror ref={lightRef} value="[1]" language="json" />
  );
  await waitFor(() => expect(lightRef.current?.view).toBeTruthy());
  const lightView = lightRef.current!.view!;
  const lightClass = highlightingFor(lightView.state, [tags.string]);
  expect(lightClass).toBeTruthy();
  expect(ruleFor(lightClass!)).toContain('var(--tk-text-cyan)');
  expect(lightView.state.facet(EditorView.darkTheme)).toBe(false);
  unmount();

  setPrefersColorScheme('dark');
  try {
    const darkRef = createRef<CodeMirrorRef>();
    renderWithProviders(
      <CodeMirror ref={darkRef} value="[1]" language="json" />
    );
    await waitFor(() => expect(darkRef.current?.view).toBeTruthy());
    const darkView = darkRef.current!.view!;
    const darkClass = highlightingFor(darkView.state, [tags.string]);
    expect(darkClass).toBeTruthy();
    // Same static role-token style, but reinstalled alongside the dark chrome
    // -- proves the highlight extension lives in the reconfigured theme
    // compartment rather than a fixed top-level extension.
    expect(ruleFor(darkClass!)).toContain('var(--tk-text-cyan)');
    expect(darkView.state.facet(EditorView.darkTheme)).toBe(true);
  } finally {
    // The simulated dark preference must not outlive this test; later tests
    // in this file assume the light default.
    setPrefersColorScheme('light');
  }
});

test('the lint underline and gutter marker use the bad/warn role tokens instead of a raw-hex data URI', async () => {
  renderWithProviders(<CodeMirror value="x" />);

  await waitFor(() => {
    expect(screen.getByTestId('codemirror-editor').textContent).toContain('x');
  });

  const styleText = Array.from(document.querySelectorAll('style'))
    .map(tag => tag.textContent ?? '')
    .join('\n');
  expect(styleText).toContain('var(--tk-text-bad-vivid)');
  expect(styleText).toContain('var(--tk-text-warn-vivid)');
});

test('the active line and selection washes are a subtle token tint, not a heavy fixed color', async () => {
  renderWithProviders(<CodeMirror value="x" />);

  await waitFor(() => {
    expect(screen.getByTestId('codemirror-editor').textContent).toContain('x');
  });

  const styleText = Array.from(document.querySelectorAll('style'))
    .map(tag => tag.textContent ?? '')
    .join('\n');
  expect(styleText).toContain(
    'color-mix(in srgb, var(--mantine-color-text) var(--tk-wash), transparent)'
  );
  expect(styleText).toContain(
    'color-mix(in srgb, var(--tk-fill-accent) var(--tk-wash), transparent)'
  );
});

test('the kit highlight style also colors javascript, the other language the kit offers', async () => {
  const ref = createRef<CodeMirrorRef>();
  renderWithProviders(
    <CodeMirror
      ref={ref}
      value={'// a comment\nconst x = 1;'}
      language="javascript"
    />
  );
  await waitFor(() => expect(ref.current?.view).toBeTruthy());
  const view = ref.current!.view!;

  const keywordClass = highlightingFor(view.state, [tags.keyword]);
  expect(keywordClass).toBeTruthy();
  expect(
    view.dom.querySelector(`.${keywordClass!.split(' ')[0]}`)
  ).toBeTruthy();
  expect(ruleFor(keywordClass!)).toContain('var(--tk-text-purple)');
});

test('a zero-width diagnostic renders a lint point styled from the bad-hue role token, not a raw colour', async () => {
  const { forceLinting } = await import('@codemirror/lint');
  const ref = createRef<CodeMirrorRef>();
  // A value position that gets "]" instead of a value: the lezer JSON
  // grammar's own error-recovery node lands here at zero width (see
  // jsonSchema.test.ts's "anchors a parse error at the real break"), which
  // @codemirror/lint renders as a `cm-lintPoint`, not a `cm-lintRange` mark.
  renderWithProviders(
    <CodeMirror
      ref={ref}
      value={'{"a": ]'}
      language="json"
      jsonCheck={() => []}
    />
  );
  await waitFor(() => expect(ref.current?.view).toBeTruthy());
  const view = ref.current!.view!;
  forceLinting(view);
  await waitFor(() => {
    expect(view.dom.querySelector('.cm-lintPoint-error')).toBeTruthy();
  });

  const styleText = Array.from(document.querySelectorAll('style'))
    .map(tag => tag.textContent ?? '')
    .join('\n');
  expect(styleText).toMatch(
    /\.cm-lintPoint-error:after\s*\{[^}]*var\(--tk-text-bad-vivid\)/
  );
  expect(styleText).toMatch(
    /\.cm-lintPoint-warning:after\s*\{[^}]*var\(--tk-text-warn-vivid\)/
  );
});

test('without jsonCheck there is no linting at all', async () => {
  const { diagnosticCount, forceLinting } = await import('@codemirror/lint');
  const ref = createRef<CodeMirrorRef>();
  renderWithProviders(<CodeMirror ref={ref} value="[1" language="json" />);
  await waitFor(() => expect(ref.current?.view).toBeTruthy());
  const view = ref.current!.view!;
  // Waits past the linter's 250ms delay before asserting -- otherwise this
  // would pass vacuously (the count is 0 before the linter has ever run).
  forceLinting(view);
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(diagnosticCount(view.state)).toBe(0);
});
