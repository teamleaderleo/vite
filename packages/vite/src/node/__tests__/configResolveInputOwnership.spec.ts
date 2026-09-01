import http from 'node:http'
import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'
import { cloneConfigForResolve } from '../configClone'

test('keeps repeated config resolution idempotent', async () => {
  const optimizerPlugin = {
    name: 'test:resolve-config-idempotence',
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

test('resolves a frozen inline config root', async () => {
  const inlineConfig = Object.freeze({
    configFile: false,
    logLevel: 'silent' as const,
  })

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.inlineConfig).toBe(inlineConfig)
})

test('keeps Vite resolver writes out of caller-owned option containers', async () => {
  const optimizerPlugin = { name: 'test:optimizer-plugin' }
  const optimizerOutput = Object.freeze({})
  const optimizerRolldownOptions = {
    output: optimizerOutput,
    plugins: [optimizerPlugin],
  }
  const optimizerEsbuildOptions = Object.freeze({})
  const optimizeDeps = Object.freeze({
    rolldownOptions: optimizerRolldownOptions,
    esbuildOptions: optimizerEsbuildOptions,
  })
  const resolveOptions = Object.freeze({
    conditions: ['source'],
    mainFields: ['module'],
  })
  const clientDev = Object.freeze({})
  const ssrBuild = Object.freeze({})
  const hmr = Object.freeze({ port: 24678 })
  const lightningcss = Object.freeze({})
  const serverAllowedHosts = ['example.test']
  const previewAllowedHosts = ['preview.example.test']
  Object.freeze(serverAllowedHosts)
  Object.freeze(previewAllowedHosts)

  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    build: Object.freeze({ ssrEmitAssets: true }),
    worker: Object.freeze({}),
    resolve: resolveOptions,
    optimizeDeps,
    ssr: Object.freeze({ optimizeDeps: Object.freeze({}) }),
    css: { transformer: 'lightningcss', lightningcss },
    server: {
      hmr,
      allowedHosts: serverAllowedHosts,
      warmup: { clientFiles: ['src/client.ts'] },
    },
    preview: { allowedHosts: previewAllowedHosts },
    environments: {
      client: { dev: clientDev },
      ssr: { build: ssrBuild },
    },
  }

  await resolveConfig(inlineConfig, 'serve')

  expect(Object.keys(optimizeDeps)).toEqual([
    'rolldownOptions',
    'esbuildOptions',
  ])
  expect(
    Object.getOwnPropertyDescriptor(optimizeDeps, 'rollupOptions'),
  ).toBeUndefined()
  expect('topLevelVar' in optimizerOutput).toBe(false)
  expect('preserveSymlinks' in optimizerEsbuildOptions).toBe(false)
  expect(resolveOptions).toEqual({
    conditions: ['source'],
    mainFields: ['module'],
  })
  expect('warmup' in clientDev).toBe(false)
  expect('emitAssets' in ssrBuild).toBe(false)
  expect(Object.getOwnPropertyDescriptor(hmr, 'port')?.get).toBeUndefined()
  expect('targets' in lightningcss).toBe(false)
  expect(serverAllowedHosts).toEqual(['example.test'])
  expect(previewAllowedHosts).toEqual(['preview.example.test'])
})

test('preserves opaque values inside copied Vite option containers', async () => {
  const service = {
    calls: 0,
    bump() {
      this.calls++
    },
  }
  const wsServer = http.createServer()

  try {
    const inlineConfig = {
      configFile: false,
      logLevel: 'silent',
      server: {
        ws: { server: wsServer },
        frameworkService: service,
      },
      plugins: [
        {
          name: 'test:framework-service',
          config(config: any) {
            expect(config.server.frameworkService).toBe(service)
            config.server.frameworkService.bump()
          },
        },
      ],
    } satisfies InlineConfig & {
      server: NonNullable<InlineConfig['server']> & {
        frameworkService: typeof service
      }
    }

    const resolved = await resolveConfig(inlineConfig, 'serve')

    expect(service.calls).toBe(1)
    expect(resolved.server.ws?.server).toBe(wsServer)
  } finally {
    wsServer.removeAllListeners()
  }
})

test('preserves opaque aliases across copied config containers', () => {
  const shared = {
    calls: 0,
    run() {
      this.calls++
    },
  }
  const inlineConfig = {
    server: { cors: shared },
    frameworkService: shared,
  } as InlineConfig & { frameworkService: typeof shared }

  const cloned = cloneConfigForResolve(inlineConfig)

  expect((cloned.server as any).cors).toBe(shared)
  expect((cloned as typeof inlineConfig).frameworkService).toBe(shared)
})

test('keeps ResolvedConfig.inlineConfig pointing at the caller input', async () => {
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.inlineConfig).toBe(inlineConfig)
})
