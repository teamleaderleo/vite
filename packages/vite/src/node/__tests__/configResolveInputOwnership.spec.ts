import http from 'node:http'
import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'
import { createLogger } from '../logger'

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

test('accepts frozen caller config containers', async () => {
  const optimizeDeps = Object.freeze({ rolldownOptions: {} })
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
  }

  await expect(resolveConfig(inlineConfig, 'serve')).resolves.toBeDefined()
})

test('does not install rollup compatibility state on caller options', async () => {
  const rollupOptions = {}
  const optimizeDeps = { rollupOptions }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
  }

  await resolveConfig(inlineConfig, 'serve')

  const rollupDescriptor = Object.getOwnPropertyDescriptor(
    optimizeDeps,
    'rollupOptions',
  )
  expect(rollupDescriptor?.get).toBeUndefined()
  expect(rollupDescriptor?.value).toBe(rollupOptions)
  expect(inlineConfig.optimizeDeps?.rolldownOptions).toBeUndefined()
})

test('does not install hmr compatibility accessors on caller server config', async () => {
  const hmr = { host: 'example.test' }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server: { hmr },
  }

  await resolveConfig(inlineConfig, 'serve')

  const hostDescriptor = Object.getOwnPropertyDescriptor(hmr, 'host')
  expect(hostDescriptor?.get).toBeUndefined()
  expect(hostDescriptor?.value).toBe('example.test')
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

test('does not expose custom config fields to configResolved mutation', async () => {
  const custom = { nested: { count: 0 } }
  const inlineConfig = {
    configFile: false,
    logLevel: 'silent',
    custom,
    plugins: [
      {
        name: 'test:mutate-config-resolved-input',
        configResolved(config: unknown) {
          const resolved = config as { custom: typeof custom }
          resolved.custom.nested.count++
        },
      },
    ],
  } satisfies InlineConfig & { custom: typeof custom }

  await resolveConfig(inlineConfig, 'serve')

  expect(custom.nested.count).toBe(0)
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

test('preserves caller-owned server instances', async () => {
  const wsServer = http.createServer()
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server: { ws: { server: wsServer } },
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.server.ws?.server).toBe(wsServer)
})

test('preserves custom logger identity', async () => {
  const customLogger = createLogger('silent')
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    customLogger,
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.logger).toBe(customLogger)
})

test('preserves terser nameCache identity', async () => {
  const nameCache = {}
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    build: {
      terserOptions: {
        nameCache,
      },
    },
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.build.terserOptions.nameCache).toBe(nameCache)
  expect(resolved.environments.client.build.terserOptions.nameCache).toBe(
    nameCache,
  )
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
