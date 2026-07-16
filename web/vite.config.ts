import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Serve at http://mets.masterelectronics.com (hosts-file entry) locally
    // AND at http://<machine-ip>/ for demo viewers on the LAN — 0.0.0.0
    // binds every interface; raw-IP hosts are always allowed by Vite, the
    // allowedHosts entry covers the DNS name. Port 80 so URLs need no port.
    // The API (3001) and Postgres (5433) stay loopback-only; everything
    // rides the /api proxy below.
    host: '0.0.0.0',
    port: 80,
    allowedHosts: ['mets.masterelectronics.com'],
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
