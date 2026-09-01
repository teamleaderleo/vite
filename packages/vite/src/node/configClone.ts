const topLevelConfigContainers = new Set([
  'define',
  'dev',
  'build',
  'resolve',
  'html',
  'css',
  'json',
  'esbuild',
  'oxc',
  'builder',
  'server',
  'preview',
  'experimental',
  'future',
  'legacy',
  'worker',
  'optimizeDeps',
  'ssr',
  'devtools',
])

const pluginCollectionPaths = new Set([
  'plugins',
  'worker.plugins',
  'build.rolldownOptions.plugins',
  'build.rollupOptions.plugins',
  'build.rolldownOptions.output.plugins',
  'build.rollupOptions.output.plugins',
  'worker.rolldownOptions.plugins',
  'worker.rollupOptions.plugins',
  'worker.rolldownOptions.output.plugins',
  'worker.rollupOptions.output.plugins',
  'optimizeDeps.esbuildOptions.plugins',
  'optimizeDeps.rolldownOptions.plugins',
  'optimizeDeps.rollupOptions.plugins',
  'optimizeDeps.rolldownOptions.output.plugins',
  'optimizeDeps.rollupOptions.output.plugins',
  'css.postcss.plugins',
  'css.preprocessorOptions.less.plugins',
])

function isArrayIndex(key: PropertyKey): boolean {
  return typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)
}

function normalizeConfigPath(
  path: readonly PropertyKey[],
): readonly PropertyKey[] {
  if (path[0] === 'environments' && path.length >= 2) {
    return path.slice(2)
  }
  return path
}

function isPath(
  path: readonly PropertyKey[],
  ...parts: readonly string[]
): boolean {
  return (
    path.length === parts.length &&
    parts.every((part, index) => path[index] === part)
  )
}

function pathWithoutArrayIndexes(path: readonly PropertyKey[]): string | undefined {
  const parts: string[] = []
  for (const part of path) {
    if (isArrayIndex(part)) continue
    if (typeof part !== 'string') return
    parts.push(part)
  }
  return parts.join('.')
}

function isPluginLeaf(rawPath: readonly PropertyKey[]): boolean {
  const path = normalizeConfigPath(rawPath)
  if (!isArrayIndex(path[path.length - 1])) return false
  const collectionPath = pathWithoutArrayIndexes(path)
  return collectionPath != null && pluginCollectionPaths.has(collectionPath)
}

function isBundlerOutputContainer(path: readonly PropertyKey[]): boolean {
  const withoutIndexes = pathWithoutArrayIndexes(path)
  return (
    withoutIndexes === 'build.rolldownOptions.output' ||
    withoutIndexes === 'build.rollupOptions.output' ||
    withoutIndexes === 'worker.rolldownOptions.output' ||
    withoutIndexes === 'worker.rollupOptions.output' ||
    withoutIndexes === 'optimizeDeps.rolldownOptions.output' ||
    withoutIndexes === 'optimizeDeps.rollupOptions.output'
  )
}

function isConfigContainer(rawPath: readonly PropertyKey[]): boolean {
  if (isPath(rawPath, 'environments')) return true

  const path = normalizeConfigPath(rawPath)
  if (path.length === 0) return true

  if (
    path.length === 1 &&
    typeof path[0] === 'string' &&
    topLevelConfigContainers.has(path[0])
  ) {
    return true
  }

  if (
    path.length === 2 &&
    path[0] === 'build' &&
    [
      'lib',
      'modulePreload',
      'terserOptions',
      'rolldownOptions',
      'rollupOptions',
      'commonjsOptions',
      'dynamicImportVarsOptions',
      'watch',
      'license',
    ].includes(path[1] as string)
  ) {
    return true
  }

  if (
    path.length === 2 &&
    path[0] === 'worker' &&
    ['rolldownOptions', 'rollupOptions'].includes(path[1] as string)
  ) {
    return true
  }

  if (
    path.length === 2 &&
    path[0] === 'optimizeDeps' &&
    ['esbuildOptions', 'rolldownOptions', 'rollupOptions'].includes(
      path[1] as string,
    )
  ) {
    return true
  }

  if (
    path.length === 2 &&
    path[0] === 'ssr' &&
    ['optimizeDeps', 'resolve'].includes(path[1] as string)
  ) {
    return true
  }

  if (
    path.length === 2 &&
    path[0] === 'css' &&
    ['modules', 'preprocessorOptions', 'postcss', 'lightningcss'].includes(
      path[1] as string,
    )
  ) {
    return true
  }

  if (
    path.length === 3 &&
    path[0] === 'css' &&
    path[1] === 'preprocessorOptions' &&
    ['scss', 'sass', 'less', 'styl', 'stylus'].includes(path[2] as string)
  ) {
    return true
  }

  if (
    path.length === 2 &&
    (path[0] === 'server' || path[0] === 'preview') &&
    [
      'hmr',
      'ws',
      'warmup',
      'fs',
      'middlewareMode',
      'https',
      'proxy',
      'cors',
      'watch',
      'forwardConsole',
    ].includes(path[1] as string)
  ) {
    return true
  }

  if (
    path.length === 3 &&
    (path[0] === 'server' || path[0] === 'preview') &&
    path[1] === 'proxy'
  ) {
    return true
  }

  if (
    path.length === 3 &&
    path[0] === 'resolve' &&
    path[1] === 'alias' &&
    isArrayIndex(path[2])
  ) {
    return true
  }

  if (isBundlerOutputContainer(path)) return true

  // `resolveDepOptimizationOptions` writes defaults into these nested
  // Rolldown option containers during resolution.
  if (
    path.length === 3 &&
    path[0] === 'optimizeDeps' &&
    path[1] === 'rolldownOptions' &&
    ['resolve', 'output', 'transform', 'moduleTypes'].includes(path[2] as string)
  ) {
    return true
  }

  return false
}

function isPreservedState(rawPath: readonly PropertyKey[]): boolean {
  const path = normalizeConfigPath(rawPath)
  return (
    isPath(path, 'build', 'terserOptions', 'nameCache') ||
    isPath(path, 'esbuild', 'mangleCache') ||
    isPath(path, 'optimizeDeps', 'esbuildOptions', 'mangleCache')
  )
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

function shouldPreserveObject(
  value: object,
  path: readonly PropertyKey[],
  isRoot: boolean,
): boolean {
  if (isRoot || value instanceof RegExp || Array.isArray(value)) return false
  if (isPreservedState(path) || isPluginLeaf(path)) return true

  const isPlain = isPlainConfigObject(value)
  if (!isPlain) return true
  return !isConfigContainer(path) && hasOwnBehavior(value)
}

function collectPreservedObjects(
  value: unknown,
  path: readonly PropertyKey[],
  preserved: WeakSet<object>,
  visiting: WeakSet<object>,
  isRoot = false,
): void {
  if (value == null || typeof value !== 'object') return
  if (preserved.has(value)) return

  if (shouldPreserveObject(value, path, isRoot)) {
    preserved.add(value)
    return
  }
  if (value instanceof RegExp || visiting.has(value)) return

  visiting.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) continue
    collectPreservedObjects(
      descriptor.value,
      [...path, key],
      preserved,
      visiting,
    )
  }
  visiting.delete(value)
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
          cloneConfigValue(
            descriptor.value,
            [...path, key],
            preserved,
            seen,
          ),
        )
      } else {
        Object.defineProperty(cloned, key, descriptor)
      }
    }
    return cloned
  }

  const isPlain = isPlainConfigObject(value)
  if (!isPlain && !isRoot) return value

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
 * Configuration containers are detached from the caller input. Opaque runtime,
 * plugin, service, and mutable state values retain their identity because
 * arbitrary JavaScript services cannot be cloned faithfully. If one object is
 * reachable through both kinds of paths, identity preservation wins.
 */
export function cloneConfigForResolve<T>(config: T): T {
  const preserved = new WeakSet<object>()
  collectPreservedObjects(config, [], preserved, new WeakSet(), true)
  return cloneConfigValue(config, [], preserved, new WeakMap(), true) as T
}
