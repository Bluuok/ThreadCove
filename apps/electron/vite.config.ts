import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({ root: resolve(import.meta.dirname, 'src/renderer'), base: './', plugins: [react()],
  server: { port: 5174 }, build: { outDir: resolve(import.meta.dirname, 'dist/renderer'), emptyOutDir: true } });
