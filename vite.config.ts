/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { createHash } from 'node:crypto';

const { version: APP_VERSION } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

/**
 * Production Content-Security-Policy. Documents are untrusted, so even if sanitizing
 * ever failed, inline and third-party scripts still could not run.
 * 'unsafe-inline' styles are required by CodeMirror, KaTeX and Mermaid output.
 */
const csp = (env: Record<string, string>) => {
  // Sharing (Google sign-in + the Worker API) is only allowed when the build is configured for it.
  const api = env.VITE_API_URL && env.VITE_GOOGLE_CLIENT_ID ? new URL(env.VITE_API_URL) : null;
  const google = 'https://accounts.google.com/gsi/';
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets pdf.js run its image decoders (JPEG 2000, ICC); it allows
    // WebAssembly only, not eval() of text.
    `script-src 'self' 'wasm-unsafe-eval'${api ? ` ${google}client` : ''}`,
    `style-src 'self' 'unsafe-inline'${api ? ` ${google}style` : ''}`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    // The desktop app talks to its native side over Tauri's IPC protocol. The AI providers are
    // called directly (with the user's own key) only when the user adds one in Settings.
    `connect-src 'self'${process.env.TAURI_ENV_PLATFORM ? ' ipc: http://ipc.localhost' : ''} https://api.anthropic.com https://api.openai.com http://localhost:* http://127.0.0.1:* http://[::1]:*${api ? ` ${api.origin} ${api.origin.replace(/^http/, 'ws')} ${google}` : ''}`,
    "object-src 'none'",
    `frame-src ${api ? google : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
};

const cspPlugin = (env: Record<string, string>): Plugin => ({
  name: 'mydoc-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp(env)}" />`,
    ),
});

/**
 * pdf.js reads character maps (CJK and other non-Latin PDFs), standard fonts and image
 * decoders from files. They're served from this app, so the CSP stays 'self' and nothing
 * is fetched from a third party. They're cached when first used, not at install.
 */
const PDFJS_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const PDFJS_ROOT = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url));

function* pdfjsFiles(dir: string, prefix = ''): Generator<string> {
  for (const name of readdirSync(join(PDFJS_ROOT, dir, prefix))) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(PDFJS_ROOT, dir, rel)).isDirectory()) yield* pdfjsFiles(dir, rel);
    else if (!name.startsWith('LICENSE')) yield `${dir}/${rel}`;
  }
}

const pdfjsAssetsPlugin = (): Plugin => ({
  name: 'mydoc-pdfjs-assets',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0]!;
      if (!path.startsWith('/pdfjs/')) return next();
      const file = normalize(join(PDFJS_ROOT, decodeURIComponent(path.slice('/pdfjs/'.length))));
      const dir = PDFJS_DIRS.find((d) => file.startsWith(join(PDFJS_ROOT, d) + sep));
      if (!dir || !existsSync(file) || statSync(file).isDirectory()) return next();
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(readFileSync(file));
    });
  },
  generateBundle() {
    for (const dir of PDFJS_DIRS)
      for (const file of pdfjsFiles(dir))
        this.emitFile({
          type: 'asset',
          fileName: `pdfjs/${file}`,
          source: readFileSync(join(PDFJS_ROOT, file)),
        });
  },
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
      (f) => !f.endsWith('.map') && f !== '/sw.js' && !f.startsWith('/pdfjs/'),
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

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [
    react(),
    tailwindcss(),
    cspPlugin(loadEnv(mode, process.cwd(), 'VITE_')),
    pdfjsAssetsPlugin(),
    serviceWorkerPlugin(),
  ],
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
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'worker/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
}));
