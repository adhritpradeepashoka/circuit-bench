import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// `npm run build:single` → dist/index.html with everything inlined (opens straight from disk).
export default defineConfig({
  plugins: process.env.SINGLE ? [viteSingleFile()] : [],
  resolve: { alias: { 'vlab-monaco-worker': fileURLToPath(new URL(process.env.SINGLE ? './src/ui/editors/monaco-worker.inline.js' : './src/ui/editors/monaco-worker.js', import.meta.url)) } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, ...(process.env.SINGLE ? {} : { rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), blog: fileURLToPath(new URL('./blog.html', import.meta.url)) } } }) },
  // `npm run dev` + `npm run server` in another terminal: the compile service is proxied at /api
  server: { open: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
