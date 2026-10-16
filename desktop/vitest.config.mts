import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests run in plain Node (22.13+ for node:sqlite); the only Electron thing the code under test needs is `app.getPath`.
export default defineConfig({
  resolve: {
    alias: { electron: fileURLToPath(new URL('./test/electron-stub.ts', import.meta.url)) }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
