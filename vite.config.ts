/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: process.env.BASE_PATH || '/mtg-commander-deck-generator/',
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/edhrec-api': {
        target: 'https://json.edhrec.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/edhrec-api/, ''),
      },
      '/scryfall-api': {
        target: 'https://api.scryfall.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/scryfall-api/, ''),
        headers: {
          'User-Agent': 'MtgMakeDeckForMe/1.0',
          'Accept': 'application/json',
        },
      },
      // The tagger S3 bucket has no CORS headers for localhost — proxying it means the
      // SpellChroma tag index (and brew's tag-lift pack filtering) works in local dev too.
      '/tagger-s3': {
        target: 'https://mtg-deck-builder-tagger.s3.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tagger-s3/, ''),
      },
    },
  },
})
