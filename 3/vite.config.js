import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8765',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:8765',
        changeOrigin: true,
      },
    },
  },
});
