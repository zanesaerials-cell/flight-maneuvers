import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';

// Shown in issue reports so a report can be matched to the build the tester was using.
function appVersion() {
  let sha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  if (!sha) { try { sha = execSync('git rev-parse HEAD').toString().trim(); } catch { sha = 'dev'; } }
  return `${sha.slice(0, 7)} (${new Date().toISOString().slice(0, 10)})`;
}

// `npm run build` -> normal multi-file build for Vercel.
// `npm run build:single` -> one self-contained HTML file (used for quick previews).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 2000,
  },
}));
