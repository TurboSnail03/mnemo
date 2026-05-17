import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

/**
 * PWA Cache-Busting Plugin
 * ─────────────────────────
 * Replaces the `__BUILD_TS__` placeholder in public/sw.js with the current
 * ISO timestamp *before* Vite copies the public directory to dist/.
 * This guarantees every production deployment gets a unique SW cache name,
 * so stale caches are deleted on activate without manually bumping a number.
 */
function stampServiceWorker() {
  return {
    name: 'stamp-service-worker',
    buildStart() {
      const swPath   = resolve(__dirname, 'public/sw.js')
      const original = readFileSync(swPath, 'utf-8')
      // Only replace if the placeholder is still present (idempotent in dev)
      if (original.includes('__BUILD_TS__')) {
        const stamped = original.replace(
          '__BUILD_TS__',
          new Date().toISOString().replace(/[:.]/g, '-')
        )
        // Write to a temp file Vite will pick up from public/
        writeFileSync(swPath, stamped, 'utf-8')
        // Register a cleanup to restore the placeholder after build
        process.once('exit', () => writeFileSync(swPath, original, 'utf-8'))
      }
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // Only stamp in production builds — in dev the SW version is 'mnemo-v3-__BUILD_TS__'
    // which is fine; dev SW is irrelevant since Vite HMR handles updates.
    ...(command === 'build' ? [stampServiceWorker()] : []),
  ],

  // Expose the build time to the app for "last updated" display if needed
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },

  build: {
    // Generate source maps in prod for debugging without exposing source in
    // the network tab (hidden maps)
    sourcemap: 'hidden',
  },
}))
