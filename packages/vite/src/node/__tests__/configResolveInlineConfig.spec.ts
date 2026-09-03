import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'
import { mergeConfig } from '../utils'

test('keeps early compatibility writes out of inline config', async () => {
  const build = Object.freeze({})
  const worker = Object.freeze({})
  const rolldownOptions = Object.freeze({})
  const optimizeDeps = Object.freeze({ rolldownOptions })
  const ssr = Object.freeze({})
  const inlineConfig: InlineConfig = Object.freeze({
    configFile: false,
    logLevel: 'silent' as const,
    build,
    worker,
    optimizeDeps,
    ssr,
    plugins: [
      {
        name: 'test:early-compat-copy',
        config(config) {
          expect(config.build).not.toBe(build)
          expect(config.worker).not.toBe(worker)
          expect(config.optimizeDeps).not.toBe(optimizeDeps)
          expect(config.ssr).not.toBe(ssr)
          expect(
            Object.getOwnPropertyDescriptor(config.build!, 'rollupOptions')
              ?.get,
          ).toBeTypeOf('function')
          expect(
            Object.getOwnPropertyDescriptor(config.worker!, 'rollupOptions')
              ?.get,
          ).toBeTypeOf('function')
          expect(
            Object.getOwnPropertyDescriptor(
              config.optimizeDeps!,
              'rollupOptions',
            )?.get,
          ).toBeTypeOf('function')
          expect(
            Object.getOwnPropertyDescriptor(
              config.ssr!.optimizeDeps!,
              'rollupOptions',
            )?.get,
          ).toBeTypeOf('function')
        },
      },
    ],
  })

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.inlineConfig).toBe(inlineConfig)
  expect(
    Object.getOwnPropertyDescriptor(build, 'rollupOptions'),
  ).toBeUndefined()
  expect(
    Object.getOwnPropertyDescriptor(worker, 'rollupOptions'),
  ).toBeUndefined()
  expect(
    Object.getOwnPropertyDescriptor(optimizeDeps, 'rollupOptions'),
  ).toBeUndefined()
  expect('optimizeDeps' in ssr).toBe(false)
})

test('keeps later-written config objects shared through config hooks', async () => {
  const server = { port: 5173 }
  const preview = { port: 4173 }
  const css = { devSourcemap: true }
  const resolve = { conditions: ['source'] }
  const environments = { client: {} }
  let getterCalls = 0
  Object.defineProperty(server, 'frameworkService', {
    enumerable: true,
    get() {
      getterCalls++
      return { value: 1 }
    },
  })

  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server,
    preview,
    css,
    resolve,
    environments,
    plugins: [
      {
        name: 'test:late-write-identity',
        config(config) {
          expect(config.server).toBe(server)
          expect(config.preview).toBe(preview)
          expect(config.css).toBe(css)
          expect(config.resolve).toBe(resolve)
          expect(config.environments).toBe(environments)
          expect(getterCalls).toBe(0)
        },
      },
    ],
  }

  await resolveConfig(inlineConfig, 'serve')
})

test('keeps environment normalization writes out of inline config', async () => {
  const clientDev = Object.freeze({})
  const client = Object.freeze({ dev: clientDev })
  const ssrDev = Object.freeze({})
  const ssrBuild = Object.freeze({})
  const ssr = Object.freeze({ dev: ssrDev, build: ssrBuild })
  const environments = Object.freeze({ client, ssr })
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server: {
      warmup: {
        clientFiles: ['src/client.ts'],
        ssrFiles: ['src/ssr.ts'],
      },
    },
    build: { ssrEmitAssets: true },
    environments,
  }

  await resolveConfig(inlineConfig, 'serve')

  expect('warmup' in clientDev).toBe(false)
  expect('warmup' in ssrDev).toBe(false)
  expect('emitAssets' in ssrBuild).toBe(false)
  expect(environments.client).toBe(client)
  expect(environments.ssr).toBe(ssr)
})

test('keeps server, preview, css, and fs writes out of inline config', async () => {
  const hmr = Object.freeze({ port: 24678 })
  const allowedHosts = ['server.example.test']
  const previewAllowedHosts = ['preview.example.test']
  const fsAllow = ['/project']
  Object.freeze(allowedHosts)
  Object.freeze(previewAllowedHosts)
  Object.freeze(fsAllow)
  const lightningcss = Object.freeze({})
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server: { hmr, allowedHosts, fs: { allow: fsAllow } },
    preview: { allowedHosts: previewAllowedHosts },
    css: { transformer: 'lightningcss', lightningcss },
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(Object.getOwnPropertyDescriptor(hmr, 'port')?.get).toBeUndefined()
  expect(allowedHosts).toEqual(['server.example.test'])
  expect(previewAllowedHosts).toEqual(['preview.example.test'])
  expect(fsAllow).toEqual(['/project'])
  expect('targets' in lightningcss).toBe(false)
  expect(resolved.server.allowedHosts).not.toBe(allowedHosts)
  expect(resolved.preview.allowedHosts).not.toBe(previewAllowedHosts)
  expect(resolved.server.fs.allow).not.toBe(fsAllow)
  expect(resolved.css.lightningcss).not.toBe(lightningcss)
})

test('keeps dependency optimizer writes out of nested inline config', async () => {
  const resolve = Object.freeze({})
  const output = Object.freeze({})
  const rolldownOptions = Object.freeze({ resolve, output })
  const esbuildOptions = Object.freeze({ minify: true })
  const optimizeDeps = Object.freeze({ rolldownOptions, esbuildOptions })
  const envResolve = Object.freeze({})
  const envOutput = Object.freeze({})
  const envRolldownOptions = Object.freeze({
    resolve: envResolve,
    output: envOutput,
  })
  const envOptimizeDeps = Object.freeze({
    rolldownOptions: envRolldownOptions,
    esbuildOptions: Object.freeze({ minify: true }),
  })

  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
    environments: {
      client: { optimizeDeps: envOptimizeDeps },
    },
  }

  await resolveConfig(inlineConfig, 'serve')

  expect('symlinks' in resolve).toBe(false)
  expect('topLevelVar' in output).toBe(false)
  expect('preserveSymlinks' in esbuildOptions).toBe(false)
  expect('symlinks' in envResolve).toBe(false)
  expect('topLevelVar' in envOutput).toBe(false)
})

test('preserves rollupOptions and rolldownOptions compatibility aliasing', async () => {
  const rolldownOptions = {}
  const optimizeDeps = {
    rolldownOptions,
    rollupOptions: rolldownOptions,
  }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.optimizeDeps.rollupOptions).toBe(
    resolved.optimizeDeps.rolldownOptions,
  )
  expect(optimizeDeps.rolldownOptions).toBe(rolldownOptions)
  expect(optimizeDeps.rollupOptions).toBe(rolldownOptions)
})

test('keeps environment build compatibility writes out of merge overrides', () => {
  const build = Object.freeze({})
  const inlineConfig: InlineConfig = {
    environments: { client: { build } },
  }

  const merged = mergeConfig({}, inlineConfig)
  const mergedBuild = merged.environments.client.build!

  expect(mergedBuild).not.toBe(build)
  expect(
    Object.getOwnPropertyDescriptor(mergedBuild, 'rollupOptions')?.get,
  ).toBeTypeOf('function')
  expect(
    Object.getOwnPropertyDescriptor(build, 'rollupOptions'),
  ).toBeUndefined()
})
