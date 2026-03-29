import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',

      // Generate manifest.json (not .webmanifest) so it matches the public/ reference
      manifestFilename: 'manifest.json',

      // PWA manifest — mirrors public/manifest.json but is injected by the plugin
      manifest: {
        name: 'Hebrew Pronunciation Coach',
        short_name: 'HebrewCoach',
        description: 'Practice reading Hebrew aloud with real-time pronunciation feedback',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },

      workbox: {
        // Pre-cache all static build assets
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],

        // Runtime caching strategies
        runtimeCaching: [
          {
            // API calls: always try network, fall back to nothing (no stale data)
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
          {
            // Google Fonts (if added later)
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },

      // Show SW update prompt in devtools during development
      devOptions: {
        enabled: false, // flip to true if you want to test SW locally
      },
    }),
  ],

  server: {
    // Dev proxy: /api/* → http://localhost:8000/api/*
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
