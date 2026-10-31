import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), dts({ include: ['src'], insertTypesEntry: true })],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'GiorgioIM',
      fileName: (format) => `giorgio-im.${format === 'es' ? 'js' : 'umd.cjs'}`,
    },
    rollupOptions: { external: ['vue'], output: { globals: { vue: 'Vue' } } },
  },
  test: { environment: 'jsdom' },
})
