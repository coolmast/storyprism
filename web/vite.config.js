import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Plain env vars here (no VITE_ prefix needed/wanted - this is read by
  // Node in the config file, never shipped to the browser), loaded the same
  // way `dotenv/config` loads server/.env: from a .env file next to this
  // config plus whatever's already in the process environment.
  const env = loadEnv(mode, process.cwd(), '')

  // Vite's dev server rejects requests for any Host header it doesn't
  // recognize (an unrelated site can't rebind a victim's localhost dev
  // server via DNS to steal its responses) - so exposing this dev server
  // through a reverse proxy under its own domain (e.g. behind mTLS +
  // Authentik forward-auth, as in this project's actual deployment) needs
  // that domain allow-listed explicitly; there's no way to derive it from
  // the proxy target Vite already knows. Comma-separated in ALLOWED_HOSTS
  // (web/.env or server env), e.g. ALLOWED_HOSTS=story.example.com. Unset
  // keeps Vite's default (localhost + LAN addresses only).
  const allowedHosts = env.ALLOWED_HOSTS
    ? env.ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : undefined

  return {
    plugins: [react()],
    server: {
      allowedHosts,
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
  }
})
