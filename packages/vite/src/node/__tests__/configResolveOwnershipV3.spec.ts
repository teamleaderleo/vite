import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

test('preserves the public inlineConfig identity', async () => {
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.inlineConfig).toBe(inlineConfig)
})

test('does not expose caller nested config to direct config-hook mutation', async () => {
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
          config.resolve.conditions.push('from-hook')
          config.define ??= {}
          config.define.__FROM_HOOK__ = 'true'
        },
      },
    ],
  }

  await resolveConfig(inlineConfig, 'serve')

  expect(conditions).toEqual(['source'])
  expect(inlineConfig.define).toBeUndefined()
})

test('does not install compatibility state on frozen caller options', async () => {
  const rolldownOptions = {}
  const optimizeDeps = Object.freeze({ rolldownOptions })
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
  }

  await expect(resolveConfig(inlineConfig, 'serve')).resolves.toBeDefined()

  expect(Object.keys(optimizeDeps)).toEqual(['rolldownOptions'])
  expect(
    Object.getOwnPropertyDescriptor(optimizeDeps, 'rollupOptions')?.get,
  ).toBeUndefined()
})

test('preserves class plugin identity', async () => {
  let calls = 0
  class TestPlugin {
    name = 'test:class-plugin'
    config() {
      calls++
    }
  }
  const plugin = new TestPlugin()
  const resolved = await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      plugins: [plugin],
    },
    'serve',
  )

  expect(calls).toBe(1)
  expect(resolved.plugins).toContain(plugin)
})

test('isolates terser options while preserving nth_identifier state', async () => {
  const nthIdentifier = {
    count: 0,
    get(n: number) {
      this.count++
      return `x${n}`
    },
  }
  const terserOptions: any = {
    mangle: { nth_identifier: nthIdentifier },
  }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    build: { terserOptions },
    plugins: [
      {
        name: 'test:mutate-terser-options',
        config(config) {
          ;(config.build!.terserOptions as any).compress = false
        },
      },
    ],
  }

  const resolved = await resolveConfig(inlineConfig, 'build')

  expect(terserOptions.compress).toBeUndefined()
  const resolvedNthIdentifier = resolved.build.terserOptions.mangle
    ?.nth_identifier as typeof nthIdentifier
  expect(resolvedNthIdentifier).toBe(nthIdentifier)
  expect(resolvedNthIdentifier.get(1)).toBe('x1')
  expect(nthIdentifier.count).toBe(1)
})

test('isolates Sass options while preserving importer state', async () => {
  const importer = {
    calls: 0,
    canonicalize() {
      this.calls++
      return null
    },
    load() {
      return null
    },
  }
  const scss: any = { importers: [importer] }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    css: { preprocessorOptions: { scss } },
    plugins: [
      {
        name: 'test:mutate-sass-options',
        config(config) {
          ;(config.css!.preprocessorOptions!.scss as any).quietDeps = true
        },
      },
    ],
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(scss.quietDeps).toBeUndefined()
  const resolvedImporter = (resolved.css.preprocessorOptions?.scss as any)
    .importers[0]
  expect(resolvedImporter).toBe(importer)
  resolvedImporter.canonicalize()
  expect(importer.calls).toBe(1)
})

test('isolates PostCSS options while preserving custom syntax state', async () => {
  const syntax = {
    calls: 0,
    parse() {
      this.calls++
    },
    stringify() {
      return undefined
    },
  }
  const postcss: any = { syntax }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    css: { postcss },
    plugins: [
      {
        name: 'test:mutate-postcss-options',
        config(config) {
          ;(config.css!.postcss as any).map = false
        },
      },
    ],
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(postcss.map).toBeUndefined()
  const resolvedSyntax = (resolved.css.postcss as any).syntax as typeof syntax
  expect(resolvedSyntax).toBe(syntax)
  resolvedSyntax.parse()
  expect(syntax.calls).toBe(1)
})

test('does not mutate optimizer option containers', async () => {
  const output = {
    banner() {
      return '/* banner */'
    },
  }
  const rolldownOptions = { output }
  const esbuildOptions = {}
  await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: { rolldownOptions, esbuildOptions },
    },
    'serve',
  )

  expect('topLevelVar' in output).toBe(false)
  expect('preserveSymlinks' in esbuildOptions).toBe(false)
})

test('preserves unknown behavior-bearing service objects', async () => {
  const service = {
    count: 0,
    bump() {
      this.count++
    },
  }
  const inlineConfig = {
    configFile: false,
    logLevel: 'silent',
    customService: service,
    plugins: [
      {
        name: 'test:custom-service',
        config(config: any) {
          config.customService.bump()
        },
      },
    ],
  } satisfies InlineConfig & { customService: typeof service }

  await resolveConfig(inlineConfig, 'serve')

  expect(service.count).toBe(1)
})
