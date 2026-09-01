const viteConfigObjectRoots = new Set([
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

const preservedObjectPaths = new Set([
  'customLogger',
  'resolve.alias.customResolver',
  'build.terserOptions.nameCache',
  'build.terserOptions.mangle.nth_identifier',
  'build.terserOptions.mangle.properties.nth_identifier',
  'esbuild.mangleCache',
  'optimizeDeps.esbuildOptions.mangleCache',
  'css.postcss.syntax',
  'css.postcss.parser',
  'css.postcss.stringifier',
  'css.lightningcss.visitor',
  'css.preprocessorOptions.scss.logger',
  'css.preprocessorOptions.sass.logger',
  'css.preprocessorOptions.scss.importer',
  'css.preprocessorOptions.sass.importer',
  'css.preprocessorOptions.scss.importers',
  'css.preprocessorOptions.sass.importers',
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
  rawPath: readonly PropertyKey[],
): readonly PropertyKey[] {
  if (rawPath[0] === 'environments' && rawPath.length >= 2) {
    return rawPath.slice(2)
  }
  if (rawPath[0] === 'ssr' && rawPath[1] === 'optimizeDeps') {
    return rawPath.slice(1)
  }
  return rawPath
}

function configPathKey(path: readonly PropertyKey[]): string | undefined {
  const parts: string[] = []
  for (const part of normalizeConfigPath(path)) {
    if (isArrayIndex(part)) continue
    if (typeof part !== 'string') return
    parts.push(part)
  }
  return parts.join('.')
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
  rawPath: readonly PropertyKey[],
  isRoot: boolean,
): boolean {
  if (isRoot || value instanceof RegExp || Array.isArray(value)) return false
  if (!isPlainConfigObject(value)) return true

  const path = normalizeConfigPath(rawPath)
  const pathKey = configPathKey(rawPath)
  if (pathKey && preservedObjectPaths.has(pathKey)) return true

  if (
    isArrayIndex(path[path.length - 1]) &&
    pathKey &&
    pluginCollectionPaths.has(pathKey)
  ) {
    return true
  }

  const rootKey = path[0]
  return (
    hasOwnBehavior(value) &&
    (typeof rootKey !== 'string' || !viteConfigObjectRoots.has(rootKey))
  )
}

function forEachEnumerableProperty(
  value: object,
  callback: (key: PropertyKey, descriptor: PropertyDescriptor) => void,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor?.enumerable) callback(key, descriptor)
  }
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
  forEachEnumerableProperty(value, (key, descriptor) => {
    if ('value' in descriptor) {
      collectPreservedObjects(
        descriptor.value,
        [...path, key],
        preserved,
        visiting,
      )
    }
  })
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
  if (seen.has(value)) return seen.get(value)

  if (value instanceof RegExp) {
    const cloned = new RegExp(value.source, value.flags)
    cloned.lastIndex = value.lastIndex
    seen.set(value, cloned)
    return cloned
  }

  const cloned: Record<PropertyKey, unknown> | unknown[] = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype)

  if (!Array.isArray(value) && !isPlainConfigObject(value) && !isRoot) {
    return value
  }

  seen.set(value, cloned)
  forEachEnumerableProperty(value, (key, descriptor) => {
    if ('value' in descriptor) {
      Reflect.set(
        cloned,
        key,
        cloneConfigValue(descriptor.value, [...path, key], preserved, seen),
      )
    } else {
      Object.defineProperty(cloned, key, descriptor)
    }
  })
  return cloned
}

/**
 * Create the mutable working config used by `resolveConfig`.
 *
 * Vite config containers are detached from the caller input. Plugins and
 * documented identity-bearing service/state values retain their identity, as
 * do opaque runtime objects and behavior-bearing values in augmented top-level
 * config. If one object is reachable through both kinds of paths, preserving
 * identity wins.
 */
export function cloneConfigForResolve<T>(config: T): T {
  const preserved = new WeakSet<object>()
  collectPreservedObjects(config, [], preserved, new WeakSet(), true)
  return cloneConfigValue(config, [], preserved, new WeakMap(), true) as T
}
