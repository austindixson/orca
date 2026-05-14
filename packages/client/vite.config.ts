import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** http-proxy defaults: tool+model HTTP responses can take many minutes (non-streaming). */
const agentProxyDefaults = {
  changeOrigin: true,
  timeout: 600_000,
  proxyTimeout: 600_000,
} as const

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        tray: path.resolve(__dirname, 'tray.html'),
      },
    },
  },
  server: {
    /** Match `tauri.conf.json` devUrl (`localhost`) so shell-origin assumptions stay consistent in dev. */
    host: 'localhost',
    port: 5173,
    /** Keep dev HMR responsive by ignoring heavy generated artifacts. */
    watch: {
      ignored: ['**/coverage/**', '**/lcov-report/**', '**/.nyc_output/**'],
    },
    /** Must match `src-tauri/tauri.conf.json` `build.devUrl`. If 5173 is busy, fail fast instead of picking another port (which would leave the Tauri shell loading the wrong origin). */
    strictPort: true,
    /** Avoid CORS failures when the shell is `localhost` but scripts fetch `127.0.0.1` (or the reverse). */
    cors: true,
    proxy: {
      // Dev telemetry lives on the Node sidecar (packages/server, PORT=3002). Rust on 3001 has no /api/dev/telemetry.
      '/api/dev/telemetry': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      // Agent tile: avoid browser CORS on LLM APIs during `vite` dev (Tauri uses plugin-http instead).
      '/__agent-proxy/openai': {
        ...agentProxyDefaults,
        target: 'https://api.openai.com',
        secure: true,
        rewrite: (p) => p.replace(/^\/__agent-proxy\/openai/, ''),
      },
      '/__agent-proxy/anthropic': {
        ...agentProxyDefaults,
        target: 'https://api.anthropic.com',
        secure: true,
        rewrite: (p) => p.replace(/^\/__agent-proxy\/anthropic/, ''),
      },
      '/__agent-proxy/openrouter': {
        ...agentProxyDefaults,
        target: 'https://openrouter.ai',
        secure: true,
        rewrite: (p) => p.replace(/^\/__agent-proxy\/openrouter/, ''),
      },
      '/__agent-proxy/google': {
        ...agentProxyDefaults,
        target: 'https://generativelanguage.googleapis.com',
        secure: true,
        rewrite: (p) => p.replace(/^\/__agent-proxy\/google/, ''),
      },
      '/__agent-proxy/zai-coding': {
        ...agentProxyDefaults,
        target: 'https://api.z.ai',
        secure: true,
        rewrite: (p) => p.replace(/^\/__agent-proxy\/zai-coding/, ''),
      },
      '/__agent-proxy/zai-bigmodel': {
        ...agentProxyDefaults,
        target: 'https://open.bigmodel.cn',
        secure: true,
        rewrite: (p) => p.replace(/^\/__agent-proxy\/zai-bigmodel/, ''),
      },
      '/__agent-proxy/ollama': {
        ...agentProxyDefaults,
        target: 'http://127.0.0.1:11434',
        rewrite: (p) => p.replace(/^\/__agent-proxy\/ollama/, ''),
      },
      '/__agent-proxy/llamacpp': {
        ...agentProxyDefaults,
        target: 'http://127.0.0.1:8000',
        rewrite: (p) => p.replace(/^\/__agent-proxy\/llamacpp/, ''),
      },
      '/__agent-proxy/hermes': {
        ...agentProxyDefaults,
        target: 'http://127.0.0.1:8642',
        rewrite: (p) => p.replace(/^\/__agent-proxy\/hermes/, ''),
        /**
         * Hermes' aiohttp gateway rejects any request whose `Origin` is not on its
         * `API_SERVER_CORS_ORIGINS` allowlist with a 403. When the allowlist is
         * unset (the default in `~/.hermes/.env`), ANY `Origin` → 403. Stripping
         * `Origin`/`Referer` on the forwarded request makes it look like a
         * same-origin/server-to-server call, which Hermes accepts. The browser
         * still gets `access-control-allow-origin: *` on the response, so the
         * webview side of CORS stays happy.
         */
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
          })
        },
      },
    },
  },
})
