function preserveObject(preserved: WeakSet<object>, value: unknown): void {
  if (value != null && typeof value === 'object') preserved.add(value)
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

function preserveBundlerPlugins(
  preserved: WeakSet<object>,
  options: any,
): void {
  if (!options || typeof options !== 'object') return
  preservePluginOptions(preserved, options.plugins)
  const outputs = Array.isArray(options.output)
    ? options.output
    : [options.output]
  for (const output of outputs) {
    preservePluginOptions(preserved, output?.plugins)
  }
}

function preserveTerserServices(preserved: WeakSet<object>, build: any): void {
  const terser = build?.terserOptions
  if (!terser || typeof terser !== 'object') return
  preserveObject(preserved, terser.nameCache)
  if (terser.mangle && typeof terser.mangle === 'object') {
    preserveObject(preserved, terser.mangle.nth_identifier)
    if (
      terser.mangle.properties &&
      typeof terser.mangle.properties === 'object'
    ) {
      preserveObject(preserved, terser.mangle.properties.nth_identifier)
    }
  }
}

function preserveBuildServices(preserved: WeakSet<object>, build: any): void {
  if (!build || typeof build !== 'object') return
  preserveTerserServices(preserved, build)
  preserveBundlerPlugins(preserved, build.rolldownOptions)
  preserveBundlerPlugins(preserved, build.rollupOptions)
}

function preserveOptimizeDepsServices(
  preserved: WeakSet<object>,
  optimizeDeps: any,
): void {
  if (!optimizeDeps || typeof optimizeDeps !== 'object') return
  preservePluginOptions(preserved, optimizeDeps.esbuildOptions?.plugins)
  preserveBundlerPlugins(preserved, optimizeDeps.rolldownOptions)
  preserveBundlerPlugins(preserved, optimizeDeps.rollupOptions)
}

function preserveCssServices(preserved: WeakSet<object>, css: any): void {
  if (!css || typeof css !== 'object') return
  preservePluginOptions(preserved, css.postcss?.plugins)
  preservePluginOptions(preserved, css.preprocessorOptions?.less?.plugins)

  for (const lang of ['scss', 'sass']) {
    const options = css.preprocessorOptions?.[lang]
    if (!options || typeof options !== 'object') continue
    preservePluginOptions(preserved, options.importers)
    preserveObject(preserved, options.logger)
  }

  preserveObject(preserved, css.lightningcss?.visitor)
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

function preserveEnvironmentServices(
  preserved: WeakSet<object>,
  environment: any,
): void {
  if (!environment || typeof environment !== 'object') return
  preserveBuildServices(preserved, environment.build)
  preserveOptimizeDepsServices(preserved, environment.optimizeDeps)
}

function collectIdentityValues(config: any): WeakSet<object> {
  const preserved = new WeakSet<object>()

  preservePluginOptions(preserved, config?.plugins)
  preserveObject(preserved, config?.customLogger)
  preserveAliasResolvers(preserved, config?.resolve)
  preserveBuildServices(preserved, config?.build)
  preserveOptimizeDepsServices(preserved, config?.optimizeDeps)
  preserveOptimizeDepsServices(preserved, config?.ssr?.optimizeDeps)
  preserveCssServices(preserved, config?.css)

  if (config?.environments && typeof config.environments === 'object') {
    for (const environment of Object.values<any>(config.environments)) {
      preserveEnvironmentServices(preserved, environment)
    }
  }

  return preserved
}

function isPlainConfigObject(value: object): boolean {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false
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

function startsWithPath(
  path: readonly PropertyKey[],
  prefix: readonly string[],
): boolean {
  return prefix.every((part, index) => path[index] === part)
}

function normalizeEnvironmentPath(
  path: readonly PropertyKey[],
): readonly PropertyKey[] {
  return path[0] === 'environments' && path.length >= 2 ? path.slice(2) : path
}

function isConfigContainerWithCallbacks(
  rawPath: readonly PropertyKey[],
): boolean {
  const path = normalizeEnvironmentPath(rawPath)
  if (path.length === 0) return true

  if (
    path.length === 1 &&
    [
      'dev',
      'build',
      'resolve',
      'worker',
      'optimizeDeps',
      'ssr',
      'builder',
      'experimental',
    ].includes(path[0] as string)
  ) {
    return true
  }

  const callbackContainerPrefixes = [
    ['build', 'terserOptions'],
    ['build', 'rolldownOptions'],
    ['build', 'rollupOptions'],
    ['build', 'lib'],
    ['build', 'modulePreload'],
    ['worker', 'rolldownOptions'],
    ['worker', 'rollupOptions'],
    ['optimizeDeps', 'esbuildOptions'],
    ['optimizeDeps', 'rolldownOptions'],
    ['optimizeDeps', 'rollupOptions'],
    ['ssr', 'optimizeDeps'],
    ['css', 'modules'],
    ['css', 'postcss'],
    ['css', 'lightningcss'],
    ['esbuild'],
    ['oxc'],
  ]
  if (
    callbackContainerPrefixes.some((prefix) => startsWithPath(path, prefix))
  ) {
    return true
  }

  return (
    path.length >= 3 &&
    path[0] === 'css' &&
    path[1] === 'preprocessorOptions' &&
    ['scss', 'sass', 'less', 'styl', 'stylus'].includes(path[2] as string)
  )
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
        Reflect.set(
          cloned,
          key,
          cloneConfigValue(descriptor.value, [...path, key], preserved, seen),
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
    !isConfigContainerWithCallbacks(path) &&
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
 * Config containers are detached from the caller input while values that act as
 * services or mutable state keep their identity. Arbitrary JavaScript service
 * objects cannot be cloned faithfully, so unknown behavior-bearing objects are
 * retained unless they are a config container Vite itself needs to modify.
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
