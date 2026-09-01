from pathlib import Path

clone = r'''function preserveObject(
  preserved: WeakSet<object>,
  value: unknown,
): void {
  if (value != null && typeof value === 'object') {
    preserved.add(value)
  }
}

function preservePluginOptions(
  preserved: WeakSet<object>,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    for (const item of value) preservePluginOptions(preserved, item)
  } else {
    preserveObject(preserved, value)
  }
}

function preserveBuildOptions(
  preserved: WeakSet<object>,
  build: any,
): void {
  if (!build || typeof build !== 'object') return
  preserveObject(preserved, build.terserOptions)
  preserveObject(preserved, build.rollupOptions)
  preserveObject(preserved, build.rolldownOptions)
  preserveObject(preserved, build.commonjsOptions)
  preserveObject(preserved, build.dynamicImportVarsOptions)
  preserveObject(preserved, build.watch)
}

function preserveOptimizeDepsOptions(
  preserved: WeakSet<object>,
  optimizeDeps: any,
): void {
  if (!optimizeDeps || typeof optimizeDeps !== 'object') return
  preserveObject(preserved, optimizeDeps.esbuildOptions)
  preserveObject(preserved, optimizeDeps.rollupOptions)
  preserveObject(preserved, optimizeDeps.rolldownOptions)
}

function preserveCssOptions(
  preserved: WeakSet<object>,
  css: any,
): void {
  if (!css || typeof css !== 'object') return
  preserveObject(preserved, css.modules)
  preserveObject(preserved, css.preprocessorOptions)
  preserveObject(preserved, css.postcss)
  preserveObject(preserved, css.lightningcss)
}

function preserveServerOptions(
  preserved: WeakSet<object>,
  server: any,
): void {
  if (!server || typeof server !== 'object') return
  preserveObject(preserved, server.https)
  preserveObject(preserved, server.proxy)
  preserveObject(preserved, server.cors)
  preserveObject(preserved, server.watch)
}

function preserveAliasResolvers(
  preserved: WeakSet<object>,
  resolve: any,
): void {
  if (!resolve || !Array.isArray(resolve.alias)) return
  for (const alias of resolve.alias) {
    preserveObject(preserved, alias?.customResolver)
  }
}

function collectIdentityValues(config: any): WeakSet<object> {
  const preserved = new WeakSet<object>()

  preservePluginOptions(preserved, config?.plugins)
  preserveObject(preserved, config?.customLogger)
  preserveObject(preserved, config?.esbuild)
  preserveObject(preserved, config?.oxc)
  preserveObject(preserved, config?.devtools)
  preserveBuildOptions(preserved, config?.build)
  preserveOptimizeDepsOptions(preserved, config?.optimizeDeps)
  preserveCssOptions(preserved, config?.css)
  preserveServerOptions(preserved, config?.server)
  preserveServerOptions(preserved, config?.preview)
  preserveAliasResolvers(preserved, config?.resolve)

  if (config?.worker && typeof config.worker === 'object') {
    preserveObject(preserved, config.worker.rollupOptions)
    preserveObject(preserved, config.worker.rolldownOptions)
  }

  preserveOptimizeDepsOptions(preserved, config?.ssr?.optimizeDeps)

  if (config?.environments && typeof config.environments === 'object') {
    for (const environment of Object.values<any>(config.environments)) {
      preserveBuildOptions(preserved, environment?.build)
      preserveOptimizeDepsOptions(preserved, environment?.optimizeDeps)
    }
  }

  return preserved
}

function isPlainConfigObject(value: object): boolean {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype == null
}

function hasOwnBehavior(value: object): boolean {
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    if (descriptor.get || descriptor.set) return true
    if ('value' in descriptor && typeof descriptor.value === 'function') {
      return true
    }
  }
  return false
}

function isViteCallbackContainer(path: readonly PropertyKey[]): boolean {
  if (path.length === 0) return true
  if (path.length === 1) {
    return (
      path[0] === 'build' ||
      path[0] === 'worker' ||
      path[0] === 'server' ||
      path[0] === 'builder' ||
      path[0] === 'experimental'
    )
  }
  if (
    path.length === 2 &&
    path[0] === 'build' &&
    (path[1] === 'lib' || path[1] === 'modulePreload')
  ) {
    return true
  }
  if (
    path.length >= 3 &&
    path[0] === 'environments' &&
    (path[2] === 'dev' || path[2] === 'build')
  ) {
    return true
  }
  if (
    path.length >= 4 &&
    path[0] === 'environments' &&
    path[2] === 'build' &&
    (path[3] === 'lib' || path[3] === 'modulePreload')
  ) {
    return true
  }
  return false
}

function cloneConfigValue(
  value: unknown,
  path: readonly PropertyKey[],
  preserved: WeakSet<object>,
  seen: WeakMap<object, unknown>,
  isRoot = false,
): unknown {
  if (value == null || typeof value !== 'object') return value
  if (preserved.has(value)) return value

  const existing = seen.get(value)
  if (existing !== undefined) return existing

  if (value instanceof RegExp) {
    const cloned = new RegExp(value.source, value.flags)
    cloned.lastIndex = value.lastIndex
    seen.set(value, cloned)
    return cloned
  }

  if (Array.isArray(value)) {
    const cloned = new Array(value.length)
    seen.set(value, cloned)
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable) continue
      if ('value' in descriptor) {
        cloned[key as any] = cloneConfigValue(
          descriptor.value,
          [...path, key],
          preserved,
          seen,
        )
      } else {
        Object.defineProperty(cloned, key, descriptor)
      }
    }
    return cloned
  }

  const isPlain = isPlainConfigObject(value)
  if (!isPlain && !isRoot) return value
  if (
    isPlain &&
    !isViteCallbackContainer(path) &&
    hasOwnBehavior(value)
  ) {
    return value
  }

  const cloned: Record<PropertyKey, unknown> = Object.create(
    Object.getPrototypeOf(value) === null ? null : Object.prototype,
  )
  seen.set(value, cloned)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) continue
    if ('value' in descriptor) {
      cloned[key] = cloneConfigValue(
        descriptor.value,
        [...path, key],
        preserved,
        seen,
      )
    } else {
      Object.defineProperty(cloned, key, descriptor)
    }
  }
  return cloned
}

/**
 * Create the mutable working config used by `resolveConfig`.
 *
 * Vite-owned config containers are detached from the caller input. Values
 * passed through to third-party APIs (plugins, preprocessors, bundlers,
 * minifiers, loggers, and similar services) retain their identity because
 * arbitrary JavaScript service/state objects cannot be cloned faithfully.
 */
export function cloneConfigForResolve<T>(config: T): T {
  return cloneConfigValue(
    config,
    [],
    collectIdentityValues(config),
    new WeakMap(),
    true,
  ) as T
}
'''
Path('packages/vite/src/node/configClone.ts').write_text(clone)

config_path = Path('packages/vite/src/node/config.ts')
text = config_path.read_text()
text = text.replace(
    "import { cloneConfig } from './configClone'",
    "import { cloneConfigForResolve } from './configClone'",
)
text = text.replace(
    '  let config = cloneConfig(inlineConfig)',
    '  let config = cloneConfigForResolve(inlineConfig)',
)
needle = "  setupRollupOptionCompat(merged, 'optimizeDeps')\n\n  const rolldownOptions = merged.rolldownOptions as Exclude<"
replacement = """  setupRollupOptionCompat(merged, 'optimizeDeps')

  // The optimizer normalizes a few nested third-party option containers below.
  // Detach only those containers before writing into them so service/plugin
  // values nested inside the option bags retain their identity.
  merged.esbuildOptions = { ...merged.esbuildOptions }
  merged.rolldownOptions = {
    ...merged.rolldownOptions,
    resolve: merged.rolldownOptions.resolve
      ? { ...merged.rolldownOptions.resolve }
      : undefined,
    output: merged.rolldownOptions.output
      ? { ...merged.rolldownOptions.output }
      : undefined,
    transform: merged.rolldownOptions.transform
      ? { ...merged.rolldownOptions.transform }
      : undefined,
    moduleTypes: merged.rolldownOptions.moduleTypes
      ? { ...merged.rolldownOptions.moduleTypes }
      : undefined,
    plugins: Array.isArray(merged.rolldownOptions.plugins)
      ? [...merged.rolldownOptions.plugins]
      : merged.rolldownOptions.plugins,
  }

  const rolldownOptions = merged.rolldownOptions as Exclude<"""
if needle not in text:
    raise SystemExit('optimizer insertion point not found')
text = text.replace(needle, replacement, 1)
config_path.write_text(text)

tests = r'''import { expect, test } from 'vitest'
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

test('preserves stateful terser nth_identifier services', async () => {
  const nthIdentifier = {
    count: 0,
    get(n: number) {
      this.count++
      return `x${n}`
    },
  }
  const resolved = await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      build: {
        terserOptions: {
          mangle: { nth_identifier: nthIdentifier },
        },
      },
    },
    'build',
  )

  const resolvedNthIdentifier = resolved.build.terserOptions.mangle
    ?.nth_identifier as typeof nthIdentifier
  expect(resolvedNthIdentifier).toBe(nthIdentifier)
  expect(resolvedNthIdentifier.get(1)).toBe('x1')
  expect(nthIdentifier.count).toBe(1)
})

test('preserves stateful Sass importer services', async () => {
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
  const resolved = await resolveConfig(
    {
      configFile: false,
      logLevel: 'silent',
      css: {
        preprocessorOptions: {
          scss: { importers: [importer as any] },
        },
      },
    },
    'serve',
  )

  const resolvedImporter = (resolved.css.preprocessorOptions?.scss as any)
    .importers[0]
  expect(resolvedImporter).toBe(importer)
  resolvedImporter.canonicalize()
  expect(importer.calls).toBe(1)
})

test('does not mutate optimizer rolldown option containers', async () => {
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

test('does not manufacture a custom-prototype root instance', async () => {
  class Config {
    #secret = 1
    logLevel = 'silent' as const
    configFile = false as const
    getSecret() {
      return this.#secret
    }
  }
  const inlineConfig = new Config() as InlineConfig
  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.inlineConfig).toBe(inlineConfig)
  expect(resolved.inlineConfig).toBeInstanceOf(Config)
})
'''
Path('packages/vite/src/node/__tests__/configResolveOwnershipV3.spec.ts').write_text(tests)
