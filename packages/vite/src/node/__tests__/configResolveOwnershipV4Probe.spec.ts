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

test('preserves a behavior-bearing shared object regardless of config path order', () => {
  const service = {
    calls: 0,
    run() {
      this.calls++
    },
  }
  const config = {
    server: {
      proxy: {
        '/api': service,
      },
    },
    customService: service,
  }

  const cloned = cloneConfigForResolve(config)

  expect(cloned.customService).toBe(service)
  expect(cloned.server.proxy['/api']).toBe(service)
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
    configure() {},
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
