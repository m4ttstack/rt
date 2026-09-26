import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tokens',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
  },
});
