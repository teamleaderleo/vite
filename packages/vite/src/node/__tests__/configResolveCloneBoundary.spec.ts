import { Buffer } from 'node:buffer'
import { createServer as createHttpServer } from 'node:http'
import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'
import { createLogger } from '../logger'

test('keeps resolver defaults out of the caller inline config', async () => {
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

test('keeps rollup compatibility state off caller options', async () => {
  const rollupOptions = {}
  const optimizeDeps = { rollupOptions }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
  }

  await resolveConfig(inlineConfig, 'serve')

  const descriptor = Object.getOwnPropertyDescriptor(
    optimizeDeps,
    'rollupOptions',
  )
  expect(descriptor?.get).toBeUndefined()
  expect(descriptor?.value).toBe(rollupOptions)
  expect(inlineConfig.optimizeDeps?.rolldownOptions).toBeUndefined()
})

test('keeps hmr compatibility accessors off caller options', async () => {
  const hmr = { host: 'example.test' }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server: { hmr },
  }

  await resolveConfig(inlineConfig, 'serve')

  const descriptor = Object.getOwnPropertyDescriptor(hmr, 'host')
  expect(descriptor?.get).toBeUndefined()
  expect(descriptor?.value).toBe('example.test')
})

test('keeps config-hook mutation out of the caller inline config', async () => {
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    resolve: {
      conditions: ['original'],
    },
    plugins: [
      {
        name: 'test:mutate-config-hook-input',
        config(config) {
          config.resolve!.conditions!.push('from-hook')
          config.define ??= {}
          config.define.__FROM_HOOK__ = 'true'
        },
      },
    ],
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.resolve.conditions).toContain('from-hook')
  expect(inlineConfig.resolve?.conditions).toEqual(['original'])
  expect(inlineConfig.define).toBeUndefined()
})

test('keeps configResolved mutation out of custom caller fields', async () => {
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

test('keeps repeated optimizer resolution idempotent', async () => {
  const optimizerPlugin = {
    name: 'test:clone-boundary-idempotence',
  }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      rolldownOptions: {
        plugins: [optimizerPlugin],
      },
    },
  }

  const first = await resolveConfig(inlineConfig, 'serve')
  const second = await resolveConfig(inlineConfig, 'serve')

  expect(first.environments.client.optimizeDepsPluginNames).toEqual([
    optimizerPlugin.name,
  ])
  expect(second.environments.client.optimizeDepsPluginNames).toEqual([
    optimizerPlugin.name,
  ])
})

test('preserves class plugin hooks and plugin identity', async () => {
  let configHookCalls = 0
  class ClassPlugin {
    name = 'test:clone-boundary-plugin-identity'
    config() {
      configHookCalls++
    }
  }
  const plugin = new ClassPlugin()

  const resolved = await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      plugins: [plugin],
    },
    'serve',
  )

  expect(configHookCalls).toBe(1)
  expect(resolved.plugins).toContain(plugin)
})

test('preserves custom logger identity', async () => {
  const customLogger = createLogger('silent')
  const resolved = await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      customLogger,
    },
    'serve',
  )

  expect(resolved.logger).toBe(customLogger)
})

test('preserves alias customResolver identity before config hooks', async () => {
  const customResolver = {
    resolveId() {
      return null
    },
  }
  let sameResolver = false
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    resolve: {
      alias: [
        {
          find: 'source',
          replacement: 'replacement',
          customResolver,
        },
      ],
    },
    plugins: [
      {
        name: 'test:custom-resolver-identity',
        config(config) {
          const alias = config.resolve?.alias
          sameResolver =
            Array.isArray(alias) && alias[0]?.customResolver === customResolver
        },
      },
    ],
  }

  await resolveConfig(inlineConfig, 'serve')
  expect(sameResolver).toBe(true)
})

test('preserves an opaque HTTP server reference', async () => {
  const httpServer = createHttpServer()
  try {
    const resolved = await resolveConfig(
      {
        configFile: false,
        logLevel: 'silent',
        server: {
          ws: { server: httpServer },
        },
      },
      'serve',
    )

    expect(resolved.server.ws.server).toBe(httpServer)
  } finally {
    httpServer.removeAllListeners()
  }
})

test('preserves Buffer values in inline HTTPS options', async () => {
  const cert = Buffer.from('test certificate bytes')
  const resolved = await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      server: {
        https: { cert },
      },
    },
    'serve',
  )

  expect(resolved.server.https?.cert).toBe(cert)
})

test('clones regexp state for resolver working config', async () => {
  const pattern = /foo/gy
  pattern.lastIndex = 2
  let hookPattern: RegExp | undefined
  await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      assetsInclude: pattern,
      plugins: [
        {
          name: 'test:regexp-clone',
          config(config) {
            hookPattern = config.assetsInclude as RegExp
          },
        },
      ],
    },
    'serve',
  )

  expect(hookPattern).not.toBe(pattern)
  expect(hookPattern?.source).toBe(pattern.source)
  expect(hookPattern?.flags).toBe(pattern.flags)
  expect(hookPattern?.lastIndex).toBe(2)
})

test('handles cycles between mutable config containers', async () => {
  const custom: { self?: unknown } = {}
  custom.self = custom
  let hookCustom: typeof custom | undefined
  const inlineConfig = {
    configFile: false,
    logLevel: 'silent',
    custom,
    plugins: [
      {
        name: 'test:cyclic-config',
        config(config: unknown) {
          hookCustom = (config as { custom: typeof custom }).custom
        },
      },
    ],
  } satisfies InlineConfig & { custom: typeof custom }

  await resolveConfig(inlineConfig, 'serve')

  expect(hookCustom).not.toBe(custom)
  expect(hookCustom?.self).toBe(hookCustom)
  expect(custom.self).toBe(custom)
})

test('clones a custom-prototype config root while preserving its prototype', async () => {
  let hookConfig: unknown
  class Config {
    configFile = false as const
    logLevel = 'silent' as const
    resolve = { conditions: ['source'] }
    plugins = [
      {
        name: 'test:custom-prototype-root',
        config(config: unknown) {
          hookConfig = config
        },
      },
    ]
  }
  const inlineConfig = new Config()

  await resolveConfig(inlineConfig, 'serve')

  expect(hookConfig).not.toBe(inlineConfig)
  expect(hookConfig).toBeInstanceOf(Config)
  expect(inlineConfig.resolve.conditions).toEqual(['source'])
})
