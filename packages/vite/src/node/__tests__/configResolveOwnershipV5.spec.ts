import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'
import { cloneConfigForResolve } from '../configClone'

test('preserves name-only Vite plugin identity', async () => {
  const plugin = { name: 'test:name-only-plugin' }
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

test('preserves shared service identity even when another path is a config container', () => {
  const service = {
    calls: 0,
    origin() {
      this.calls++
      return true
    },
  }
  const config = {
    server: { cors: service },
    customService: service,
  }

  const cloned = cloneConfigForResolve(config)

  expect(cloned.customService).toBe(service)
  expect(cloned.server.cors).toBe(service)
})

test('isolates build rolldown output option bags with callbacks', async () => {
  const output = {
    banner() {
      return '/* banner */'
    },
  }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    build: { rolldownOptions: { output } },
    plugins: [
      {
        name: 'test:mutate-output-options',
        config(config) {
          const output = config.build?.rolldownOptions?.output
          if (output && !Array.isArray(output)) {
            output.entryFileNames = 'changed.js'
          }
        },
      },
    ],
  }

  await resolveConfig(inlineConfig, 'build')

  expect('entryFileNames' in output).toBe(false)
})

test('isolates server proxy route option bags with callbacks', async () => {
  const proxyRoute = {
    target: 'http://example.test',
    configure() {
      return undefined
    },
  }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server: { proxy: { '/api': proxyRoute } },
    plugins: [
      {
        name: 'test:mutate-proxy-route',
        config(config) {
          const route = config.server?.proxy?.['/api']
          if (typeof route === 'object') {
            route.changeOrigin = true
          }
        },
      },
    ],
  }

  await resolveConfig(inlineConfig, 'serve')

  expect('changeOrigin' in proxyRoute).toBe(false)
})

test('preserves name-only optimizer plugin identity', async () => {
  const plugin = { name: 'test:name-only-optimizer-plugin' }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      rolldownOptions: { plugins: [plugin] },
    },
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')
  const resolvedPlugin = resolved.optimizeDeps.rolldownOptions?.plugins?.[0]

  expect(resolvedPlugin).toBe(plugin)
})
