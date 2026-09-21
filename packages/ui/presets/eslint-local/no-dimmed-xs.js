// The spec's size bands: text at the small step (Mantine `xs`) takes the
// high-contrast token, so `dimmed` at `xs` is the size trap by construction.
const SMALL = new Set(['xs']);

function literal(attr) {
  const v = attr.value;
  if (!v) return null;
  if (v.type === 'Literal') return v.value;
  if (v.type === 'JSXExpressionContainer' && v.expression.type === 'Literal')
    return v.expression.value;
  return null;
}

export default {
  meta: {
    type: 'problem',
    messages: {
      dimmedXs:
        'Dimmed text at size "xs" reads under the small-text bar; use size "sm" or drop c="dimmed" (the default text is the high-contrast token).',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        let size = null;
        let dimmed = false;
        for (const attr of node.attributes) {
          if (attr.type !== 'JSXAttribute' || !attr.name) continue;
          if (attr.name.name === 'size') size = literal(attr);
          if (attr.name.name === 'c' && literal(attr) === 'dimmed')
            dimmed = true;
        }
        if (dimmed && size !== null && SMALL.has(size))
          context.report({ node, messageId: 'dimmedXs' });
      },
    };
  },
};
