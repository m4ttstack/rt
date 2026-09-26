export default {
  meta: {
    type: 'suggestion',
    messages: { missing: '<{{name}}> needs a data-testid.' },
  },
  create(context) {
    const TARGETS = new Set([
      'Button',
      'Anchor',
      'UnstyledButton',
      'FileButton',
    ]);
    return {
      JSXOpeningElement(node) {
        if (!TARGETS.has(node.name.name)) return;
        const has = node.attributes.some(
          a => a.type === 'JSXAttribute' && a.name.name === 'data-testid'
        );
        if (!has)
          context.report({
            node,
            messageId: 'missing',
            data: { name: node.name.name },
          });
      },
    };
  },
};
