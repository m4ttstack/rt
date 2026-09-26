import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { Diagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type JsonPath = (string | number)[];
export interface JsonPathIssue {
  path: JsonPath;
  message: string;
}
export type JsonSchemaCheck = (value: unknown) => JsonPathIssue[];

type Node = ReturnType<typeof syntaxTree>['topNode'];
type Schema = Record<string, unknown>;

const VALUE_NODES = new Set([
  'Object',
  'Array',
  'String',
  'Number',
  'True',
  'False',
  'Null',
]);

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

function propertyName(state: EditorState, prop: Node): string | null {
  const name = prop.getChild('PropertyName');
  if (!name) return null;
  try {
    return JSON.parse(state.sliceDoc(name.from, name.to)) as string;
  } catch {
    return null;
  }
}

function valueOf(node: Node): Node | null {
  return children(node).find(c => VALUE_NODES.has(c.name)) ?? null;
}

/** The deepest syntax node the path reaches; a path naming a missing
    property stops at the object that should hold it. */
export function nodeAtPath(state: EditorState, path: JsonPath): Node | null {
  const tree = ensureSyntaxTree(state, state.doc.length) ?? syntaxTree(state);
  let node = valueOf(tree.topNode);
  for (const seg of path) {
    if (!node) return null;
    let next: Node | null = null;
    if (node.name === 'Object' && typeof seg === 'string') {
      const prop = children(node).find(
        c => c.name === 'Property' && propertyName(state, c) === seg
      );
      next = prop ? valueOf(prop) : null;
    } else if (node.name === 'Array' && typeof seg === 'number') {
      next = children(node).filter(c => VALUE_NODES.has(c.name))[seg] ?? null;
    }
    if (!next) return node;
    node = next;
  }
  return node;
}

/** Containers underline only their opening bracket, so one bad property
    does not paint the whole block. */
function rangeOf(node: Node): { from: number; to: number } {
  return node.name === 'Object' || node.name === 'Array'
    ? { from: node.from, to: node.from + 1 }
    : { from: node.from, to: node.to };
}

/** The first parse-error node in document order, in `node`'s subtree, or
    null if none -- lezer's tolerant JSON grammar inserts one wherever a
    document that fails `JSON.parse` actually stops matching the grammar,
    which is not always where `JSON.parse` itself reports the error. */
function firstErrorNode(node: Node): Node | null {
  const cursor = node.cursor();
  do {
    if (cursor.type.isError) return cursor.node;
  } while (cursor.next());
  return null;
}

export function jsonDiagnostics(
  state: EditorState,
  check: JsonSchemaCheck
): Diagnostic[] {
  const text = state.doc.toString();
  if (text.trim() === '') return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const tree = ensureSyntaxTree(state, text.length) ?? syntaxTree(state);
    const errorNode = firstErrorNode(tree.topNode);
    const { from, to } = errorNode
      ? { from: errorNode.from, to: errorNode.to }
      : { from: 0, to: Math.min(1, text.length) };
    return [
      {
        from,
        to,
        severity: 'error',
        message: (err as Error).message,
      },
    ];
  }
  return check(value).map(issue => {
    const node = nodeAtPath(state, issue.path);
    const { from, to } = node ? rangeOf(node) : { from: 0, to: 1 };
    return { from, to, severity: 'error', message: issue.message };
  });
}

function schemaFor(root: Schema, path: JsonPath): Schema | undefined {
  let s: Schema | undefined = root;
  for (const seg of path) {
    if (!s) return undefined;
    if (typeof seg === 'number') {
      s = s.items as Schema | undefined;
    } else {
      const props = s.properties as Record<string, Schema> | undefined;
      const add = s.additionalProperties;
      s =
        props?.[seg] ??
        (add && typeof add === 'object' ? (add as Schema) : undefined);
    }
  }
  return s;
}

/** The JSON path of the object or array `node` is. */
function pathOf(state: EditorState, node: Node): JsonPath {
  const path: JsonPath = [];
  let child = node;
  for (let p = node.parent; p; child = p, p = p.parent) {
    if (p.name === 'Property') {
      const name = propertyName(state, p);
      if (name !== null && child.name !== 'PropertyName') path.unshift(name);
    } else if (p.name === 'Array') {
      const items = children(p).filter(c => VALUE_NODES.has(c.name));
      const at = items.findIndex(c => c.from === child.from);
      if (at >= 0) path.unshift(at);
    }
  }
  return path;
}

function nameTarget(node: Node): { obj: Node; own: Node | null } | null {
  if (node.name === '{' && node.parent?.name === 'Object')
    return { obj: node.parent, own: null };
  if (node.name === 'Object') return { obj: node, own: null };
  if (node.name === '⚠' && node.parent?.name === 'Object')
    return { obj: node.parent, own: null };
  if (node.name === 'PropertyName' && node.parent?.parent?.name === 'Object')
    return { obj: node.parent.parent, own: node.parent };
  return null;
}

function valueTarget(node: Node): Node | null {
  if (node.name === 'Property') return node;
  return node.parent?.name === 'Property' && node.name !== 'PropertyName'
    ? node.parent
    : null;
}

function enumValues(s: Schema | undefined): unknown[] {
  if (!s) return [];
  if (Array.isArray(s.enum)) return s.enum;
  if ('const' in s) return [s.const];
  if (s.type === 'boolean') return [true, false];
  return [];
}

/** Replaces the quoted token this option was offered inside of, consuming
    its closing quote wherever it currently sits. A static match range
    covering both quotes filters out every option against a still-empty
    "" (the pattern is two quote characters, which no label matches), so
    the match range tracks the cursor instead (see `quotedToken` below)
    and picking an option has to close the token itself here. */
function applyQuoted(literal: string) {
  return (
    view: EditorView,
    _completion: Completion,
    from: number,
    to: number
  ) => {
    const node = syntaxTree(view.state).resolveInner(to, -1);
    const end =
      node.name === 'PropertyName' || node.name === 'String' ? node.to : to;
    view.dispatch({
      changes: { from, to: end, insert: literal },
      selection: { anchor: from + literal.length },
    });
  };
}

/** Property names the schema allows at the cursor's object, and enum,
    const or boolean values at a property's value. */
export function jsonSchemaCompletion(schema: Schema) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    const word = ctx.matchBefore(/"?[\w$-]*/);
    const quotedToken = node.name === 'PropertyName' || node.name === 'String';
    const from = quotedToken
      ? node.from
      : word && word.text !== ''
        ? word.from
        : ctx.pos;
    // `to` is left undefined (tracks the cursor) rather than the token's
    // own end, even inside a quoted token -- see `applyQuoted` above.
    const option = (literal: string, type: string) =>
      quotedToken
        ? { label: literal, type, apply: applyQuoted(literal) }
        : { label: literal, type };

    const name = nameTarget(node);
    if (name) {
      const s = schemaFor(schema, pathOf(ctx.state, name.obj));
      const props = s?.properties as Record<string, Schema> | undefined;
      if (!props) return null;
      const taken = new Set(
        children(name.obj)
          .filter(c => c.name === 'Property' && c !== name.own)
          .map(c => propertyName(ctx.state, c))
      );
      const options = Object.keys(props)
        .filter(k => !taken.has(k))
        .map(k => option(JSON.stringify(k), 'property'));
      return options.length > 0 ? { from, options } : null;
    }

    const prop = valueTarget(node);
    const key = prop ? propertyName(ctx.state, prop) : null;
    if (!prop?.parent || key === null) return null;
    const values = enumValues(
      schemaFor(schema, [...pathOf(ctx.state, prop.parent), key])
    );
    if (values.length === 0) return null;
    return {
      from,
      options: values.map(v => option(JSON.stringify(v), 'enum')),
    };
  };
}
