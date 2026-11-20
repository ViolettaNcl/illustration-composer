import { defineConfig } from 'vite';

export default defineConfig({
  // relative base so the build works on GitHub Pages / any sub-path
  base: './',
  build: { target: 'es2022' },
});
