import http from 'node:http'
import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'
import { createLogger } from '../logger'

test('does not mutate caller-owned config during resolution', async () => {
  const optimizeDeps = { rollupOptions: {} }
  const hmr = { host: 'example.test' }
  const conditions = ['source']
  const clientDev = {}
  const custom = { count: 0 }
  const inlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
    resolve: { conditions },
    server: {
      hmr,
      warmup: { clientFiles: ['entry.js'] },
    },
    environments: { client: { dev: clientDev } },
    custom,
    plugins: [
      {
        name: 'test:mutate-config',
        config(config: unknown) {
          const mutable = config as InlineConfig & { custom: typeof custom }
          mutable.custom.count++
          mutable.resolve!.conditions!.push('mutated')
        },
        configResolved(config: unknown) {
          ;(config as { custom: typeof custom }).custom.count++
        },
      },
    ],
  } satisfies InlineConfig & { custom: typeof custom }

  await resolveConfig(inlineConfig, 'serve')

  expect(
    Object.getOwnPropertyDescriptor(optimizeDeps, 'rollupOptions')?.get,
  ).toBeUndefined()
  expect(
    (optimizeDeps as typeof optimizeDeps & { rolldownOptions?: unknown })
      .rolldownOptions,
  ).toBeUndefined()
  expect(Object.getOwnPropertyDescriptor(hmr, 'host')?.get).toBeUndefined()
  expect(hmr.host).toBe('example.test')
  expect(clientDev).toEqual({})
  expect(conditions).toEqual(['source'])
  expect(custom.count).toBe(0)
})

test('preserves identity-sensitive inline config values', async () => {
  const plugin = { name: 'test:plugin' }
  const wsServer = http.createServer()
  const cert = Buffer.from('certificate')
  const customLogger = createLogger('silent')
  const importer = {
    canonicalize() {
      return null
    },
    load() {
      return null
    },
  }
  const inlineConfig = {
    configFile: false,
    logLevel: 'silent',
    customLogger,
    plugins: [plugin],
    server: {
      https: { cert },
      ws: { server: wsServer },
    },
    css: {
      preprocessorOptions: {
        scss: { importer },
      },
    },
  } as InlineConfig

  const resolved = await resolveConfig(inlineConfig, 'serve')
  const resolvedCss = resolved.css as unknown as {
    preprocessorOptions: { scss: { importer: typeof importer } }
  }

  expect(resolved.inlineConfig).toBe(inlineConfig)
  expect(resolved.logger).toBe(customLogger)
  expect(resolved.plugins).toContain(plugin)
  expect(resolved.server.https?.cert).toBe(cert)
  expect(resolved.server.ws?.server).toBe(wsServer)
  expect(resolvedCss.preprocessorOptions.scss.importer).toBe(importer)
})
