import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/story': 'http://localhost:3001',
      // Static assets the exported story/deck pages load at their own
      // origin (Leaflet, PhotoSwipe, reveal.js) - missing this meant every
      // one of those failed to load (404) whenever a story/deck was opened
      // via the frontend dev server's own origin (as "View story ↗"/
      // "Present ↗" do), silently breaking the map, the photo lightbox, and
      // the presentation, all at once, with no visible error to the user.
      '/vendor': 'http://localhost:3001',
    },
  },
})
