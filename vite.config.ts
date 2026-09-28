import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH lets the same app run at the root of a domain ("/") or in a
// sub-folder, e.g. GitHub Pages serves it at "/<repository-name>/".
const base = process.env.BASE_PATH ?? '/'

// The PWA plugin generates the service worker that saves the whole app
// on the device after the first online visit, so it opens with no internet.
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'adra-logo.png'],
      manifest: {
        name: 'ADRA',
        short_name: 'ADRA',
        description: 'Offline-first client support and emergency relief recording (prototype)',
        theme_color: '#0f5f5c',
        background_color: '#f6f7f5',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: `${base}index.html`,
        // PDF/Excel libraries are large; allow them to be saved for offline use
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      // Lets you test offline mode while running `npm run dev`
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
})
