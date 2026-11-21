import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@qatools/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // IMPORTANT: the '/api' proxy key is a PREFIX match, so it would also swallow the SPA
      // route '/api-tester' (because '/api-tester'.startsWith('/api')) and serve JSON instead
      // of the app. `bypass` returns a path to make Vite handle the request itself, which
      // keeps the SPA routes working while real /api/* calls are still proxied.
      '/api': {
        target: process.env.QATOOLS_API ?? 'http://127.0.0.1:5174',
        changeOrigin: true,
        bypass: (req) => {
          const path = (req.url ?? '').split('?')[0] ?? '';
          // SPA routes that merely start with "/api-" must NOT be proxied.
          if (path.startsWith('/api-')) return path;
          return null;
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
});
