import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

test('does not accumulate converted optimizeDeps esbuild plugins across repeated resolution', async () => {
  const esbuildPlugin = {
    name: 'test:esbuild-compat-idempotence',
    setup() {},
  }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      esbuildOptions: {
        plugins: [esbuildPlugin],
      },
    },
  }

  const first = await resolveConfig(inlineConfig, 'serve')
  const second = await resolveConfig(inlineConfig, 'serve')

  expect(first.environments.client.optimizeDepsPluginNames).toHaveLength(1)
  expect(second.environments.client.optimizeDepsPluginNames).toHaveLength(1)
})
