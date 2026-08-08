import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

test('converts deprecated SSR optimizeDeps esbuild plugins', async () => {
  const esbuildPlugin = {
    name: 'test:ssr-esbuild-plugin-compat',
    setup() {},
  }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    ssr: {
      optimizeDeps: {
        esbuildOptions: {
          plugins: [esbuildPlugin],
        },
      },
    },
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.environments.ssr.optimizeDepsPluginNames).toHaveLength(1)
})
