/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Production Content-Security-Policy. Documents are untrusted, so even if sanitizing
 * ever failed, inline and third-party scripts still could not run.
 * 'unsafe-inline' styles are required by CodeMirror, KaTeX and Mermaid output.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'mydoc-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    ),
});

/** Files from `public/` the offline shell needs (build output is added automatically). */
const PUBLIC_SHELL = [
  '/',
  '/index.html',
  '/theme-init.js',
  '/favicon.svg',
  '/manifest.webmanifest',
  ...readdirSync(new URL('./public/icons', import.meta.url)).map((f) => `/icons/${f}`),
];

/**
 * Emits `sw.js` with the exact list of built files, so the whole app (lazy chunks
 * included) loads offline after the first visit. No plugin dependency needed.
 */
const serviceWorkerPlugin = (): Plugin => ({
  name: 'mydoc-sw',
  apply: 'build',
  generateBundle(_options, bundle) {
    const files = [...PUBLIC_SHELL, ...Object.keys(bundle).map((f) => `/${f}`)].filter(
      (f) => !f.endsWith('.map') && f !== '/sw.js',
    );
    const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
    const template = readFileSync(new URL('./src/pwa/sw-template.js', import.meta.url), 'utf8');
    this.emitFile({
      type: 'asset',
      fileName: 'sw.js',
      source: template
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files, null, 2)),
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin(), serviceWorkerPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
