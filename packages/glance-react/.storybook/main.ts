import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';
import type { InlineConfig } from 'vite';

function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ['../lib/**/*.stories.{js,jsx,mjs,ts,tsx}'],
  addons: [
    getAbsolutePath('@chromatic-com/storybook'),
    getAbsolutePath('@storybook/addon-vitest'),
    getAbsolutePath('@storybook/addon-a11y'),
    getAbsolutePath('@storybook/addon-docs'),
  ],
  framework: getAbsolutePath('@storybook/react-vite'),
  viteFinal: async (config: InlineConfig) => {
    // Add Tailwind v4 plugin — Storybook doesn't inherit vite.config.ts plugins
    config.plugins = [...(config.plugins ?? []), tailwindcss()];
    config.resolve ??= {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@': resolve(__dirname, '../lib'),
      // Resolve workspace dep from built dist (source uses .ts extensions Vite can't resolve)
      '@workforge/glance-sdk': resolve(__dirname, '../../glance-sdk/dist/index.js'),
    };
    return config;
  },
};

export default config;
