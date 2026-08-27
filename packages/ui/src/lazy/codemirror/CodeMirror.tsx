import { forwardRef, lazy } from 'react';

import { LazyLoader } from '@mattstack/app-kit/core';
import type {
  CodeMirrorBaseProps,
  CodeMirrorLanguage,
  CodeMirrorRef,
} from './CodeMirror.Base';

const CodeMirrorLazy = lazy(() => import('./CodeMirror.Base'));

export type CodeMirrorProps = CodeMirrorBaseProps;
export type { CodeMirrorLanguage, CodeMirrorRef };

/**
 * A CodeMirror 6 text/code editor, lazily loaded behind `React.lazy` so
 * `codemirror` + `@codemirror/*` (and their language packages) stay out of
 * the app's entry bundle -- `CodeMirror.Base.tsx` (where all of that is
 * actually imported) is only fetched once this component is first rendered.
 *
 * Prop surface: value/onChange/language/readOnly plus a couple of small
 * ergonomics (`height`, `placeholder`, `autoFocus`), and an extensibility
 * tier (`extensions`, `onCreateEditor`, `onUpdate`, `theme`) for consumers
 * that need direct CodeMirror access -- see `CodeMirrorBaseProps` for the
 * full surface. `onChange` receives just the new text, matching this
 * interface's "value/onChange intent" without CodeMirror's own types
 * leaking out of `@mattstack/app-kit/lazy`.
 *
 * `ref` resolves to a `CodeMirrorRef` (`{ view: EditorView | null }`),
 * forwarded through the `React.lazy` + `Suspense` boundary via
 * `forwardRef` on both this component and `CodeMirror.Base`'s default
 * export -- `React.lazy` is transparent to ref forwarding as long as the
 * resolved component itself supports it.
 */
export const CodeMirror = /* @__PURE__ */ forwardRef<
  CodeMirrorRef,
  CodeMirrorProps
>(function CodeMirror(props, ref) {
  return (
    <LazyLoader minHeight={props.height}>
      <CodeMirrorLazy {...props} ref={ref} />
    </LazyLoader>
  );
});
