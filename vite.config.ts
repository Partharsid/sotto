import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: { assetsInlineLimit: (f) => f.endsWith('.wasm'), outDir: '../../dist/renderer', emptyOutDir: true, target: 'chrome128', sourcemap: false },
  server: { port: 3000, strictPort: true },
});
