import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import { VitePWA } from 'vite-plugin-pwa';

// Shown in issue reports so a report can be matched to the build the tester was using.
function appVersion() {
  let sha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  if (!sha) { try { sha = execSync('git rev-parse HEAD').toString().trim(); } catch { sha = 'dev'; } }
  return `${sha.slice(0, 7)} (${new Date().toISOString().slice(0, 10)})`;
}

// `npm run build` -> normal multi-file build for Vercel.
// `npm run build:single` -> one self-contained HTML file (used for quick previews).
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'single' ? [viteSingleFile()] : [
      // Works offline once opened: the app and the airplane models are kept on the device,
      // and a new version is picked up the next time it is opened online.
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['apple-touch-icon-v4.png', 'logo-v4.svg', 'favicon-32-v4.png'],
        manifest: {
          name: 'Chair Flight',
          short_name: 'Chair Flight',
          description: 'Chair-fly every checkride maneuver: 3D view, PFD, controls and steps for the airplane you fly.',
          theme_color: '#1f2328',
          background_color: '#1f2328',
          display: 'standalone',
          icons: [
            { src: 'icon-192-v4.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512-v4.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-maskable-512-v4.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          runtimeCaching: [
            { urlPattern: /\/models\/.*\.glb$/, handler: 'StaleWhileRevalidate', options: { cacheName: 'models', expiration: { maxEntries: 10 } } },
            { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'fonts' } },
          ],
        },
      }),
    ]),
  ],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 2000,
  },
}));
