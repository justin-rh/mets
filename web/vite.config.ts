import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Serve at http://mets.masterelectronics.com (hosts-file entry -> 127.0.0.1).
    // Port 80 so the URL needs no port; tests can override with --port.
    // IPv4 bind: Node resolves plain `localhost` to ::1, but the hosts entry is IPv4.
    host: '127.0.0.1',
    port: 80,
    allowedHosts: ['mets.masterelectronics.com'],
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
