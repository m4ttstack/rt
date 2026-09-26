import {
  autocompletion,
  CompletionContext,
  completionStatus,
  currentCompletions,
  insertBracket,
  startCompletion,
} from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
  jsonDiagnostics,
  jsonSchemaCompletion,
  nodeAtPath,
} from './jsonSchema';

// jsdom doesn't implement `Range.getClientRects`/`getBoundingClientRect`
// (see CodeMirror.test.tsx for the same guard); a real `EditorView` measures
// layout via `Range` on every update, so the completion tests below need it
// too.
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

const SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      category: { type: 'string' },
      owner: { type: 'string', const: 'human' },
      provider: { enum: ['gitlab', 'github'] },
    },
    required: ['pattern'],
  },
};

function state(doc: string) {
  const s = EditorState.create({ doc, extensions: [json()] });
  ensureSyntaxTree(s, doc.length);
  return s;
}

function complete(docWithCursor: string) {
  const pos = docWithCursor.indexOf('|');
  const s = state(docWithCursor.replace('|', ''));
  const r = jsonSchemaCompletion(SCHEMA)(new CompletionContext(s, pos, true));
  return r ? r.options.map(o => o.label) : null;
}

/** Mounts a real `EditorView` (json + the schema's own completion source)
    with the cursor at `|` in `docWithCursor`, for tests that need the
    autocomplete engine's own match-range filtering, not just the source
    function's raw output. */
function mountView(docWithCursor: string) {
  const pos = docWithCursor.indexOf('|');
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: docWithCursor.replace('|', ''),
      selection: { anchor: pos },
      extensions: [
        json(),
        autocompletion({ override: [jsonSchemaCompletion(SCHEMA)] }),
      ],
    }),
  });
  view.focus();
  return view;
}

async function wait(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

describe('nodeAtPath', () => {
  it('finds a property value inside an array item', () => {
    const s = state('[{"pattern": 1}, {"category": "c"}]');
    const node = nodeAtPath(s, [0, 'pattern'])!;
    expect(s.sliceDoc(node.from, node.to)).toBe('1');
  });

  it('stops at the object when the property is missing', () => {
    const s = state('[{"pattern": 1}, {"category": "c"}]');
    const node = nodeAtPath(s, [1, 'pattern'])!;
    expect(node.name).toBe('Object');
    expect(node.from).toBe(17);
  });
});

describe('jsonDiagnostics', () => {
  it('underlines each issue at its path; a container only at its bracket', () => {
    const s = state('[{"pattern": 1}, {"category": "c"}]');
    const d = jsonDiagnostics(s, () => [
      { path: [0, 'pattern'], message: 'expected string, got number' },
      {
        path: [1, 'pattern'],
        message: 'required property "pattern" is missing',
      },
    ]);
    expect(d.map(x => [x.from, x.to, x.message])).toEqual([
      [13, 14, 'expected string, got number'],
      [17, 18, 'required property "pattern" is missing'],
    ]);
  });

  it('reports a parse error once and never calls the checker', () => {
    const check = vi.fn(() => []);
    const d = jsonDiagnostics(state('[{'), check);
    expect(d).toHaveLength(1);
    expect(d[0]!.severity).toBe('error');
    expect(check).not.toHaveBeenCalled();
  });

  it('anchors a parse error at the real break, not always the document start', () => {
    // Line 1: "{", line 2: a valid property, line 3: a value position that
    // gets "]" instead of a value -- the syntax actually breaks on line 3.
    const doc = '{\n  "a": 1,\n  "b": ]\n}';
    const s = state(doc);
    const d = jsonDiagnostics(s, () => []);
    expect(d).toHaveLength(1);
    expect(s.doc.lineAt(d[0]!.from).number).toBe(3);
  });

  it('falls back to the document start when the tree has no error node', () => {
    // No `json()` language configured: `syntaxTree` returns an empty tree
    // with no error node to anchor on, so the defensive 0..1 fallback is
    // what fires here (a real caller always configures `json()`).
    const s = EditorState.create({ doc: '-' });
    const d = jsonDiagnostics(s, () => []);
    expect(d).toHaveLength(1);
    expect(d[0]!.from).toBe(0);
    expect(d[0]!.to).toBe(1);
  });

  it('an empty document has no diagnostics', () => {
    expect(
      jsonDiagnostics(state('  '), () => [{ path: [], message: 'x' }])
    ).toEqual([]);
  });
});

describe('jsonSchemaCompletion', () => {
  it('offers the property names the object does not set yet', () => {
    expect(complete('[{"pattern": "x", |}]')).toEqual([
      '"category"',
      '"owner"',
      '"provider"',
    ]);
    expect(complete('[{|}]')).toEqual([
      '"pattern"',
      '"category"',
      '"owner"',
      '"provider"',
    ]);
  });

  it('inside a half-typed name, offers every name but that property itself', () => {
    expect(complete('[{"pattern": "x", "ca|"}]')).toEqual([
      '"category"',
      '"owner"',
      '"provider"',
    ]);
  });

  it('offers enum and const values at a property value', () => {
    expect(complete('[{"provider": |}]')).toEqual(['"gitlab"', '"github"']);
    expect(complete('[{"owner": "|"}]')).toEqual(['"human"']);
  });

  it('has nothing to offer where the schema says nothing', () => {
    expect(complete('[{"pattern": |}]')).toBeNull();
  });
});

describe('jsonSchemaCompletion in a live editor', () => {
  it('opens by typing the opening quote at a property-name position', async () => {
    const view = mountView('[{|}]');
    const tr = insertBracket(view.state, '"');
    view.dispatch(tr!);
    await wait(400);
    expect(completionStatus(view.state)).toBe('active');
    expect(currentCompletions(view.state).map(o => o.label)).toEqual([
      '"category"',
      '"owner"',
      '"pattern"',
      '"provider"',
    ]);
    view.destroy();
  });

  it('opens explicitly (startCompletion) inside an already-open pair of quotes', async () => {
    const view = mountView('[{"provider": "|"}]');
    startCompletion(view);
    await wait(400);
    expect(completionStatus(view.state)).toBe('active');
    expect(currentCompletions(view.state).map(o => o.label)).toEqual([
      '"github"',
      '"gitlab"',
    ]);
    view.destroy();
  });

  it('narrows to the matching option after typing one more character at a value position', async () => {
    const view = mountView('[{"owner": |}]');
    const openQuote = insertBracket(view.state, '"');
    view.dispatch(openQuote!);
    await wait(400);
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: 'h' },
      selection: { anchor: view.state.selection.main.head + 1 },
      userEvent: 'input.type',
    });
    await wait(400);
    expect(completionStatus(view.state)).toBe('active');
    expect(currentCompletions(view.state).map(o => o.label)).toEqual([
      '"human"',
    ]);
    view.destroy();
  });
});
