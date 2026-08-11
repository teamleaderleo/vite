import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

function esbuildPlugin(name: string) {
  return {
    name,
    setup() {},
  }
}

test('converts deprecated SSR optimizeDeps esbuild plugins', async () => {
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    ssr: {
      optimizeDeps: {
        esbuildOptions: {
          plugins: [esbuildPlugin('test:ssr-esbuild-plugin-compat')],
        },
      },
    },
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.environments.ssr.optimizeDepsPluginNames).toHaveLength(1)
})

test('converts custom environment optimizeDeps esbuild plugins', async () => {
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    environments: {
      custom: {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [esbuildPlugin('test:custom-esbuild-plugin-compat')],
          },
        },
      },
    },
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.environments.custom.optimizeDepsPluginNames).toHaveLength(1)
})
