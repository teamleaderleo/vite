import http from 'node:http'
import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { cloneConfig } from '../configClone'
import { resolveConfig } from '../config'
import { createLogger } from '../logger'

async function resolveClonedConfig(inlineConfig: InlineConfig) {
  const resolved = await resolveConfig(cloneConfig(inlineConfig), 'serve')
  // A production entry clone would keep the public reference to the caller's
  // source config while using the clone only as resolver working state.
  ;(resolved as { inlineConfig: InlineConfig }).inlineConfig = inlineConfig
  return resolved
}

test('prototype isolates resolver-owned working state from caller input', async () => {
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
  }

  const resolved = await resolveClonedConfig(inlineConfig)

  expect(inlineConfig).toEqual({
    configFile: false,
    logLevel: 'silent',
  })
  expect(resolved.inlineConfig).toBe(inlineConfig)
})

test('prototype isolates direct config-hook mutations', async () => {
  const conditions = ['source']
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    resolve: { conditions },
    plugins: [
      {
        name: 'test:prototype-config-hook-isolation',
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

  const resolved = await resolveClonedConfig(inlineConfig)

  expect(inlineConfig.resolve?.conditions).toEqual(['source'])
  expect(inlineConfig.define).toBeUndefined()
  expect(resolved.resolve.conditions).toContain('mutated-by-hook')
  expect(resolved.define?.__MUTATED_BY_HOOK__).toBe('true')
})

test('prototype keeps compatibility accessors off caller config objects', async () => {
  const rollupOptions = {}
  const optimizeDeps = { rollupOptions }
  const hmr = { host: 'example.test' }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
    server: { hmr },
  }

  await resolveClonedConfig(inlineConfig)

  expect(Object.getOwnPropertyDescriptor(optimizeDeps, 'rollupOptions')?.get).toBe(
    undefined,
  )
  expect(inlineConfig.optimizeDeps?.rolldownOptions).toBeUndefined()
  expect(Object.getOwnPropertyDescriptor(hmr, 'host')?.get).toBeUndefined()
})

test('prototype accepts frozen caller config containers', async () => {
  const optimizeDeps = Object.freeze({ rolldownOptions: {} })
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
  }

  await expect(resolveClonedConfig(inlineConfig)).resolves.toBeDefined()
})

test('prototype preserves identity-bearing config values', async () => {
  const cert = Buffer.from('test certificate bytes')
  const wsServer = http.createServer()
  const customLogger = createLogger('silent')
  let configHookCalls = 0

  class ClassPlugin {
    name = 'test:prototype-class-plugin'

    config() {
      configHookCalls++
    }
  }

  const plugin = new ClassPlugin()
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    customLogger,
    plugins: [plugin],
    server: {
      https: { cert },
      ws: { server: wsServer },
    },
  }

  const resolved = await resolveClonedConfig(inlineConfig)

  expect(configHookCalls).toBe(1)
  expect(resolved.plugins).toContain(plugin)
  expect(resolved.logger).toBe(customLogger)
  expect(resolved.server.https?.cert).toBe(cert)
  expect(resolved.server.ws?.server).toBe(wsServer)
})

test('prototype preserves identity of config values created by plugin hooks', async () => {
  const pluginOwned = { state: 0 }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'test:prototype-plugin-owned-config',
        config() {
          return { custom: pluginOwned } as InlineConfig
        },
      },
    ],
  }

  const resolved = await resolveClonedConfig(inlineConfig)
  const resolvedWithCustom = resolved as typeof resolved & {
    custom: typeof pluginOwned
  }

  expect(resolvedWithCustom.custom).toBe(pluginOwned)
})

test('prototype keeps repeated resolution idempotent', async () => {
  const optimizerPlugin = { name: 'test:prototype-idempotence' }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      rolldownOptions: {
        plugins: [optimizerPlugin],
      },
    },
  }

  const first = await resolveClonedConfig(inlineConfig)
  const second = await resolveClonedConfig(inlineConfig)

  expect(first.environments.client.optimizeDepsPluginNames).toEqual([
    optimizerPlugin.name,
  ])
  expect(second.environments.client.optimizeDepsPluginNames).toEqual([
    optimizerPlugin.name,
  ])
})
