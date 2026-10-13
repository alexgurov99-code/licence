import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the build works under GitHub Pages' /<repo-name>/ sub-path.
  base: './',
  build: {
    target: 'es2022',
    // Three.js alone is ~540 kB minified; that is expected for this app.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
