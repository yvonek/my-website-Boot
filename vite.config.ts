import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@fluentui')) return 'fluent';
          if (id.includes('framer-motion')) return 'motion';
          if (id.includes('react')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: true,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
});
