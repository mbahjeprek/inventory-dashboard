import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Dev only: the Express API runs inside the Vite dev server, so everything (app + /api) is served on
// the one port 5199 - no separate backend process. Loaded through Vite's SSR loader, so an edit
// under server/src applies on the next request. Production uses api/index.ts on Vercel instead.
function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      Object.assign(process.env, { ...loadEnv(server.config.mode, process.cwd(), ''), ...process.env })
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          const { app } = await server.ssrLoadModule('/server/src/app.ts')
          app(req, res, next)
        } catch (e) {
          next(e)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
  server: {
    port: 5199,
    strictPort: true,
  },
})
