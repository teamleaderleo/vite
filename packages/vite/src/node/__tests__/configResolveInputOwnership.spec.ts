import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

test('does not write resolver working state into the caller inline config', async () => {
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
  }

  await resolveConfig(inlineConfig, 'serve')

  expect(inlineConfig).toEqual({
    configFile: false,
    logLevel: 'silent',
  })
})

test('does not expose caller-owned nested config to direct config-hook mutation', async () => {
  const conditions = ['source']
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    resolve: { conditions },
    plugins: [
      {
        name: 'test:mutate-config-hook-input',
        config(config) {
          config.resolve ??= {}
          config.resolve.conditions ??= []
          config.resolve.conditions.push('mutated-by-hook')
          config.define ??= {}
          config.define.__MUTATED_BY_HOOK__ = 'true'
        },
      },
    ],
  }

  await resolveConfig(inlineConfig, 'serve')

  expect(inlineConfig.resolve?.conditions).toEqual(['source'])
  expect(inlineConfig.define).toBeUndefined()
})

test('accepts opaque values nested in inline config', async () => {
  const cert = Buffer.from('test certificate bytes')
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server: {
      https: { cert },
    },
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.server.https?.cert).toBe(cert)
})

test('preserves class-based plugin hooks and plugin identity', async () => {
  let configHookCalls = 0

  class ClassPlugin {
    name = 'test:class-plugin'

    config() {
      configHookCalls++
    }
  }

  const plugin = new ClassPlugin()
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    plugins: [plugin],
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(configHookCalls).toBe(1)
  expect(resolved.plugins).toContain(plugin)
})
