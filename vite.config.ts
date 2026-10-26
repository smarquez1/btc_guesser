import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    manifest: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/main.ts'),
    },
  },
});
