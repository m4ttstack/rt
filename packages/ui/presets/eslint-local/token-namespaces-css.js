import { classifyTokenUse } from './token-namespaces.js';

function collectVars(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'Function' && node.name === 'var') {
    const first = node.children?.[0];
    if (first?.type === 'Identifier') out.push(first.name);
  }
  const children = node.children ?? [];
  for (const child of children) collectVars(child, out);
  if (node.value && typeof node.value === 'object')
    collectVars(node.value, out);
  return out;
}

export default {
  meta: {
    type: 'problem',
    messages: { misuse: '{{message}}' },
  },
  create(context) {
    return {
      Declaration(node) {
        for (const varName of collectVars(node.value, [])) {
          const message = classifyTokenUse(node.property, varName);
          if (message)
            context.report({ node, messageId: 'misuse', data: { message } });
        }
      },
    };
  },
};
