import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development, proxy API calls so the portal and API share an origin.
    // 127.0.0.1, not localhost: on Windows localhost can resolve to IPv6 (::1), where the API is not listening.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  build: { sourcemap: false, target: 'es2022' },
});
