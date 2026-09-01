const topLevelConfigContainers = new Set([
  'input',
  'define',
  'resolve',
  'optimizeDeps',
  'dev',
  'build',
  'plugins',
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
  'ssr',
  'environments',
  'devtools',
])

const behaviorContainerPaths = [
  'resolve.alias',
  'build.modulePreload',
  'build.lib',
  'build.terserOptions',
  'build.rolldownOptions',
  'build.rollupOptions',
  'build.watch',
  'worker.rolldownOptions',
  'worker.rollupOptions',
  'optimizeDeps.esbuildOptions',
  'optimizeDeps.rolldownOptions',
  'optimizeDeps.rollupOptions',
  'css.modules',
  'css.postcss',
  'css.lightningcss',
  'css.preprocessorOptions.scss',
  'css.preprocessorOptions.sass',
  'css.preprocessorOptions.less',
  'css.preprocessorOptions.styl',
  'css.preprocessorOptions.stylus',
  'server.hmr',
  'server.ws',
  'server.watch',
  'server.https',
  'server.cors',
  'server.proxy',
  'server.forwardConsole',
  'preview.hmr',
  'preview.ws',
  'preview.watch',
  'preview.https',
  'preview.cors',
  'preview.proxy',
  'preview.forwardConsole',
]

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
  rawPath: readonly PropertyKey[],
): readonly PropertyKey[] {
  let path = rawPath
  if (path[0] === 'environments' && path.length >= 2) {
    path = path.slice(2)
  }
  if (path[0] === 'ssr' && path[1] === 'optimizeDeps') {
    path = path.slice(1)
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

function pathWithoutArrayIndexes(
  path: readonly PropertyKey[],
): string | undefined {
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

function isSassImporterLeaf(path: readonly PropertyKey[]): boolean {
  if (!isArrayIndex(path[path.length - 1])) return false
  const collectionPath = pathWithoutArrayIndexes(path)
  return (
    collectionPath === 'css.preprocessorOptions.scss.importers' ||
    collectionPath === 'css.preprocessorOptions.sass.importers'
  )
}

function isPreservedObjectPath(rawPath: readonly PropertyKey[]): boolean {
  const path = normalizeConfigPath(rawPath)
  const withoutIndexes = pathWithoutArrayIndexes(path)

  if (isPath(path, 'customLogger')) return true
  if (withoutIndexes === 'resolve.alias.customResolver') return true

  if (
    isPath(path, 'build', 'terserOptions', 'nameCache') ||
    isPath(path, 'build', 'terserOptions', 'mangle', 'nth_identifier') ||
    isPath(
      path,
      'build',
      'terserOptions',
      'mangle',
      'properties',
      'nth_identifier',
    )
  ) {
    return true
  }

  if (
    isPath(path, 'esbuild', 'mangleCache') ||
    isPath(path, 'optimizeDeps', 'esbuildOptions', 'mangleCache')
  ) {
    return true
  }

  if (
    isPath(path, 'css', 'postcss', 'syntax') ||
    isPath(path, 'css', 'postcss', 'parser') ||
    isPath(path, 'css', 'postcss', 'stringifier') ||
    isPath(path, 'css', 'lightningcss', 'visitor')
  ) {
    return true
  }

  if (
    isPath(path, 'css', 'preprocessorOptions', 'scss', 'logger') ||
    isPath(path, 'css', 'preprocessorOptions', 'sass', 'logger') ||
    isPath(path, 'css', 'preprocessorOptions', 'scss', 'importer') ||
    isPath(path, 'css', 'preprocessorOptions', 'sass', 'importer') ||
    isSassImporterLeaf(path)
  ) {
    return true
  }

  return false
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

function isBehaviorConfigContainer(rawPath: readonly PropertyKey[]): boolean {
  const path = normalizeConfigPath(rawPath)
  if (
    path.length === 1 &&
    typeof path[0] === 'string' &&
    topLevelConfigContainers.has(path[0])
  ) {
    return true
  }

  const withoutIndexes = pathWithoutArrayIndexes(path)
  if (!withoutIndexes) return false
  return behaviorContainerPaths.some(
    (containerPath) =>
      withoutIndexes === containerPath ||
      withoutIndexes.startsWith(`${containerPath}.`),
  )
}

function shouldPreserveObject(
  value: object,
  path: readonly PropertyKey[],
  isRoot: boolean,
): boolean {
  if (isRoot || value instanceof RegExp || Array.isArray(value)) return false
  if (isPreservedObjectPath(path) || isPluginLeaf(path)) return true

  const isPlain = isPlainConfigObject(value)
  if (!isPlain) return true

  // Plain objects with behavior are ambiguous: they may be service objects, or
  // option bags that happen to contain callbacks. Only known callback-bearing
  // config containers are detached; unknown behavior-bearing objects retain
  // identity so plugin-augmented config can carry arbitrary services safely.
  return hasOwnBehavior(value) && !isBehaviorConfigContainer(path)
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
 * Mutable config containers are detached from the caller input while plugins,
 * services, runtime objects, and mutable state values retain identity. If one
 * object is reachable through both kinds of paths, identity preservation wins.
 */
export function cloneConfigForResolve<T>(config: T): T {
  const preserved = new WeakSet<object>()
  collectPreservedObjects(config, [], preserved, new WeakSet(), true)
  return cloneConfigValue(config, [], preserved, new WeakMap(), true) as T
}
