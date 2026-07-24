/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { controlledResponses } from './e2e/controlled-render-fixture.js'

function controlledEvidenceApi() {
  if (process.env.COI_CONTROLLED_RENDER !== 'true') return null

  return {
    name: 'controlled-evidence-api',
    transformIndexHtml() {
      return [{
        tag: 'script',
        children: "localStorage.setItem('token', 'controlled-render-token')",
        injectTo: 'head-prepend',
      }]
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url, 'http://controlled.local').pathname
        const payload = controlledResponses[pathname]
          || (pathname.startsWith('/api/opportunity-workspaces/') ? {
            communication_sent: false,
            transition_type: 'PREPARE',
          } : null)

        if (!payload) return next()
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(payload))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), controlledEvidenceApi()].filter(Boolean),
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
