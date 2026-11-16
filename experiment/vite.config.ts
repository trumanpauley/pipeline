import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Only the browser-only demo build (npm run build:demo) includes the in-page
// backend and PGlite. Every other build gets an empty stub instead, so not a
// byte of it ships to production.
const demoLocal = process.env.VITE_DEMO_LOCAL === '1';
const stubDemoBackend: Plugin = {
  name: 'stub-demo-backend',
  enforce: 'pre',
  resolveId(id) {
    if (id.endsWith('/demo/localBackend')) return '\0demo-backend-stub';
  },
  load(id) {
    if (id === '\0demo-backend-stub') return 'export {};';
  },
};

export default defineConfig({
  plugins: [react(), ...(demoLocal ? [] : [stubDemoBackend])],
  // PGlite ships its own WebAssembly; don't pre-bundle it.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  server: { port: 5173 },
});
