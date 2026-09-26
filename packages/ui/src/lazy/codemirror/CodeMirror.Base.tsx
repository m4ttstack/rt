import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { useComputedColorScheme } from '@mantine/core';
import { basicSetup } from 'codemirror';

// Tags a transaction as originating from the `value`-sync effect (below)
// rather than from the user editing the document, so the update listener
// can skip calling `onChange` for it -- otherwise a controlled
// `value`+`onChange` pair would have every external `value` update
// immediately echoed straight back out through `onChange`.
const externalChange = Annotation.define<boolean>();

export type CodeMirrorLanguage = 'javascript' | 'json';

export interface CodeMirrorBaseProps {
  /** The editor's content. Uncontrolled if omitted; controlled (kept in sync on change) if provided. */
  value?: string;
  /** Fired with the new document text whenever the user edits the content. */
  onChange?: (value: string) => void;
  /** Enables syntax highlighting + language-aware editing for the given language. No language support when omitted. */
  language?: CodeMirrorLanguage;
  /** Blocks edits (the editor still allows selecting/copying text). @default false */
  readOnly?: boolean;
  /** CSS height of the editor. @default '300px' */
  height?: string;
  /** Placeholder content shown when the editor is empty. */
  placeholder?: string;
  /** Focus the editor on mount. @default false */
  autoFocus?: boolean;
  /**
   * Extra `@codemirror/state` extensions appended to the editor's extension
   * list at creation (after the kit's basics/language/readOnly compartments,
   * before the theme) -- e.g. linting, autocompletion, custom keymaps. Read
   * once when the editor is created; changing this after mount does NOT
   * reconfigure the live editor (unlike `language`/`readOnly`, which are
   * held in compartments) -- remount the component (e.g. via `key`) to pick
   * up a new list.
   */
  extensions?: Extension[];
  /** Called once, right after the `EditorView` is created, with the view and its initial state. */
  onCreateEditor?: (view: EditorView, state: EditorState) => void;
  /** Called on every editor update (document changes, selection, focus, etc.), alongside `onChange`. */
  onUpdate?: (update: ViewUpdate) => void;
  /**
   * Overrides the kit's automatic scheme-aware theme. `'light'`/`'dark'`
   * force the kit's own chrome to that scheme; an `Extension` replaces the
   * theme entirely. Omitted (default): follows the computed color scheme.
   */
  theme?: 'light' | 'dark' | Extension;
}

/** Imperative handle exposed via `ref`: the live `EditorView`, or `null` before/after mount. */
export interface CodeMirrorRef {
  view: EditorView | null;
}

/**
 * Scheme-aware editor chrome. Colors reference the kit's CSS vars, so the
 * palette flips with the color scheme on its own; the `dark` flag flips
 * CodeMirror's OWN defaults (caret, selection, active line) that don't go
 * through our vars. The frame polish (padding, theme radius) rides along.
 */
const editorTheme = (height: string, dark: boolean): Extension =>
  EditorView.theme(
    {
      '&': {
        height,
        backgroundColor: 'var(--ui-bg-4)',
        color: 'var(--mantine-color-text)',
        borderRadius: 'var(--mantine-radius-default)',
        overflow: 'hidden',
      },
      '.cm-content': {
        padding: 'var(--mantine-spacing-xs)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--ui-bg-3)',
        color: 'var(--mantine-color-dimmed)',
        border: 'none',
      },
    },
    { dark }
  );

const languageExtensions: Record<CodeMirrorLanguage, () => Extension> = {
  javascript: () => javascript(),
  json: () => json(),
};

function languageExtensionFor(
  language: CodeMirrorLanguage | undefined
): Extension {
  return language ? languageExtensions[language]() : [];
}

/**
 * Resolves the `theme` prop into the extension the theme compartment holds.
 * Omitted -> the auto scheme theme (follows the computed color scheme).
 * `'light'` / `'dark'` -> the kit's own chrome, forced to that scheme.
 * An `Extension` -> used as-is, replacing the kit's theme (and its chrome)
 * entirely.
 */
function resolveThemeExtension(
  theme: 'light' | 'dark' | Extension | undefined,
  height: string,
  computedColorScheme: 'light' | 'dark'
): Extension {
  if (theme === undefined) {
    return editorTheme(height, computedColorScheme === 'dark');
  }
  if (theme === 'light' || theme === 'dark') {
    return editorTheme(height, theme === 'dark');
  }
  return theme;
}

/**
 * The real CodeMirror 6 editor: `@codemirror/*` + the `codemirror` meta
 * package's `basicSetup` (line numbers, history, bracket matching, default
 * keymap, etc.) are only ever imported by this module, which is itself only
 * ever reached through `CodeMirror.tsx`'s `React.lazy(() => import('./CodeMirror.Base'))`
 * -- so none of it enters the app's entry bundle.
 *
 * `language`/`readOnly`/`theme` are held in `Compartment`s so changing any
 * of those props reconfigures the live editor instead of tearing it down
 * and remounting. `extensions`, `onCreateEditor` are read once at creation
 * (see their prop docs above); `onUpdate` (like `onChange`) is read through
 * a ref so a fresh function identity each render doesn't force a remount.
 *
 * The `ref` (via `useImperativeHandle`) exposes the live `EditorView` as
 * `{ view }` -- a getter, so it stays correct across the create/destroy
 * effect without needing to be recomputed on every render.
 */
const CodeMirrorBase = /* @__PURE__ */ forwardRef<
  CodeMirrorRef,
  CodeMirrorBaseProps
>(function CodeMirrorBase(
  {
    value = '',
    onChange,
    language,
    readOnly = false,
    height = '300px',
    placeholder,
    autoFocus = false,
    extensions = [],
    onCreateEditor,
    onUpdate,
    theme,
  }: CodeMirrorBaseProps,
  ref
) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment()).current;
  const readOnlyCompartment = useRef(new Compartment()).current;
  const themeCompartment = useRef(new Compartment()).current;

  // Resolved 'light' | 'dark' (never 'auto'), read synchronously on first
  // render -- same anti-flicker approach as the kit's useColorScheme.
  const computedColorScheme = useComputedColorScheme('light', {
    getInitialValueInEffect: false,
  });

  // Read through a ref inside the update listener so the listener extension
  // (baked into the state at creation time) always calls the *latest*
  // `onChange`/`onUpdate` without needing to tear down and recreate the view
  // whenever the caller passes a fresh function identity.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useImperativeHandle(
    ref,
    () => ({
      get view() {
        return viewRef.current;
      },
    }),
    []
  );

  useEffect(() => {
    if (!parentRef.current) {
      return;
    }

    const updateListener = EditorView.updateListener.of(update => {
      onUpdateRef.current?.(update);
      const isExternal = update.transactions.some(tr =>
        tr.annotation(externalChange)
      );
      if (update.docChanged && !isExternal) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const allExtensions: Extension[] = [
      basicSetup,
      keymap.of([indentWithTab]),
      languageCompartment.of(languageExtensionFor(language)),
      readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
      updateListener,
      // User-supplied extensions, read once at creation -- see the
      // `extensions` prop doc for why this doesn't reconfigure live.
      ...extensions,
      themeCompartment.of(
        resolveThemeExtension(theme, height, computedColorScheme)
      ),
    ];
    if (placeholder) {
      allExtensions.push(placeholderExtension(placeholder));
    }

    const state = EditorState.create({ doc: value, extensions: allExtensions });
    const view = new EditorView({
      state,
      parent: parentRef.current,
    });
    viewRef.current = view;
    onCreateEditor?.(view, state);
    if (autoFocus) {
      view.focus();
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Editor is created once on mount; `value`/`language`/`readOnly`/`theme`
    // changes are pushed into the live view by the dedicated effects below
    // instead of recreating it (which would drop undo history + selection).
    // `extensions`/`onCreateEditor` are intentionally creation-time only --
    // see their prop docs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push external `value` changes into the live document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: [externalChange.of(true)],
      });
    }
  }, [value]);

  // Follow color-scheme/height/theme-override changes into the live editor.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure(
        resolveThemeExtension(theme, height, computedColorScheme)
      ),
    });
  }, [computedColorScheme, height, theme, themeCompartment]);

  // Reconfigure the language compartment when `language` changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageCompartment.reconfigure(languageExtensionFor(language)),
    });
  }, [language, languageCompartment]);

  // Reconfigure the readOnly compartment when `readOnly` changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(
        EditorState.readOnly.of(readOnly)
      ),
    });
  }, [readOnly, readOnlyCompartment]);

  return <div ref={parentRef} data-testid="codemirror-editor" />;
});

export default CodeMirrorBase;
