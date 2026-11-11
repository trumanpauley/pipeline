import { defineConfig } from 'vite';

// esbuild compiles TSX with React's automatic JSX runtime; no Babel plugin needed.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 600 },
});
