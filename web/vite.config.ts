import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Solana libraries need Buffer / process in the browser.
    nodePolyfills({
      include: ['buffer', 'process'],
      globals: { Buffer: true, process: true, global: true },
    }),
  ],
})
