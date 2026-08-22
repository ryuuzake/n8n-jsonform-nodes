import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/lib': path.resolve(__dirname, './src/lib'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    server: {
      deps: {
        // The renderers import vendored shadcn components via the `@/` alias;
        // inline them so Vite applies our alias resolution.
        inline: ['@fragno-dev/jsonforms-shadcn-renderers'],
      },
    },
  },
});
