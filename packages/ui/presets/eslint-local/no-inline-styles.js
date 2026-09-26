export default {
  meta: {
    type: 'suggestion',
    messages: {
      inline:
        "Inline '{{name}}' prop: style app code through the theme instead " +
        '(SomeComponent.extend({ defaultProps }) in the design-system theme, ' +
        '--ui-bg-*/--mantine-* token vars, or a CSS module).',
    },
  },
  create(context) {
    const BANNED = new Set(['style', 'styles', 'sx']);
    return {
      JSXAttribute(node) {
        if (!BANNED.has(node.name.name)) return;
        context.report({
          node,
          messageId: 'inline',
          data: { name: node.name.name },
        });
      },
    };
  },
};
