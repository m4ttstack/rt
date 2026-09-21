import { classifyTokenUse, VAR_PATTERN } from './token-namespaces.js';

function keyName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string')
    return node.value;
  return null;
}

function stringOf(node) {
  if (node.type === 'Literal' && typeof node.value === 'string')
    return node.value;
  if (node.type === 'TemplateLiteral')
    return node.quasis.map(q => q.value.cooked ?? '').join(' ');
  return null;
}

export default {
  meta: {
    type: 'problem',
    messages: { misuse: '{{message}}' },
  },
  create(context) {
    return {
      Property(node) {
        const property = keyName(node.key);
        const value = stringOf(node.value);
        if (!property || !value) return;
        for (const match of value.matchAll(VAR_PATTERN)) {
          const message = classifyTokenUse(property, match[1]);
          if (message)
            context.report({
              node: node.value,
              messageId: 'misuse',
              data: { message },
            });
        }
      },
    };
  },
};
