import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: { port: 5199, strictPort: true },
  // ANTIBIOME_WIN7=1: the Windows 7 edition renders with Electron 22's Chromium 108.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500, ...(process.env.ANTIBIOME_WIN7 ? { target: 'chrome108', cssTarget: 'chrome108' } : {}) },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
