import { Buffer } from 'node:buffer'
import { createServer as createHttpServer } from 'node:http'
import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

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
        },
      },
    ],
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.resolve.conditions).toContain('from-hook')
  expect(inlineConfig.resolve?.conditions).toEqual(['original'])
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

test('preserves user plugin identity', async () => {
  const plugin = {
    name: 'test:clone-boundary-plugin-identity',
  }

  const resolved = await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      plugins: [plugin],
    },
    'serve',
  )

  expect(resolved.plugins).toContain(plugin)
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
  const key = Buffer.from('test-key')

  const resolved = await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      server: {
        https: { key },
      },
    },
    'serve',
  )

  expect(resolved.server.https?.key).toBe(key)
})
