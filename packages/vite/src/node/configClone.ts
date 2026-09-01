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

const serverConfigContainers = new Set([
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
])

const secondLevelConfigContainers = new Map<string, ReadonlySet<string>>([
  [
    'build',
    new Set([
      'lib',
      'modulePreload',
      'terserOptions',
      'rolldownOptions',
      'rollupOptions',
      'commonjsOptions',
      'dynamicImportVarsOptions',
      'watch',
      'license',
    ]),
  ],
  ['worker', new Set(['rolldownOptions', 'rollupOptions'])],
  [
    'optimizeDeps',
    new Set(['esbuildOptions', 'rolldownOptions', 'rollupOptions']),
  ],
  ['ssr', new Set(['optimizeDeps', 'resolve'])],
  [
    'css',
    new Set(['modules', 'preprocessorOptions', 'postcss', 'lightningcss']),
  ],
  ['server', serverConfigContainers],
  ['preview', serverConfigContainers],
])

const cssPreprocessorContainers = new Set([
  'scss',
  'sass',
  'less',
  'styl',
  'stylus',
])

const optimizeDepsRolldownContainers = new Set([
  'resolve',
  'output',
  'transform',
  'moduleTypes',
])

const terserConfigContainers = new Set([
  'compress',
  'mangle',
  'format',
  'output',
  'parse',
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

function isBundlerOutputContainer(path: readonly PropertyKey[]): boolean {
  if (
    (path[0] !== 'build' && path[0] !== 'worker') ||
    (path[1] !== 'rolldownOptions' && path[1] !== 'rollupOptions') ||
    path[2] !== 'output'
  ) {
    return false
  }
  return path.length === 3 || (path.length === 4 && isArrayIndex(path[3]))
}

function isConfigContainer(rawPath: readonly PropertyKey[]): boolean {
  if (isPath(rawPath, 'environments')) return true

  const path = normalizeConfigPath(rawPath)
  if (path.length === 0) return true

  if (path.length === 1 && typeof path[0] === 'string') {
    return topLevelConfigContainers.has(path[0])
  }

  if (
    path.length === 2 &&
    typeof path[0] === 'string' &&
    typeof path[1] === 'string' &&
    secondLevelConfigContainers.get(path[0])?.has(path[1])
  ) {
    return true
  }

  if (
    path.length === 3 &&
    path[0] === 'css' &&
    path[1] === 'preprocessorOptions' &&
    typeof path[2] === 'string' &&
    cssPreprocessorContainers.has(path[2])
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

  // `resolveDepOptimizationOptions` writes defaults into these nested
  // Rolldown option containers during resolution.
  if (
    path.length === 3 &&
    path[0] === 'optimizeDeps' &&
    path[1] === 'rolldownOptions' &&
    typeof path[2] === 'string' &&
    optimizeDepsRolldownContainers.has(path[2])
  ) {
    return true
  }

  // Output option objects are callback-bearing configuration containers, while
  // plugin/service values nested inside them should keep their own identity.
  if (isBundlerOutputContainer(path)) return true

  if (
    path[0] === 'build' &&
    path[1] === 'terserOptions' &&
    ((path.length === 3 &&
      typeof path[2] === 'string' &&
      terserConfigContainers.has(path[2])) ||
      isPath(path, 'build', 'terserOptions', 'mangle', 'properties'))
  ) {
    return true
  }

  // Proxy route options are configuration bags containing callbacks and opaque
  // runtime values such as Agents. Copy the bag while retaining those leaves.
  if (
    path.length === 3 &&
    (path[0] === 'server' || path[0] === 'preview') &&
    path[1] === 'proxy'
  ) {
    return true
  }

  return false
}

function isPreservedState(rawPath: readonly PropertyKey[]): boolean {
  return isPath(
    normalizeConfigPath(rawPath),
    'build',
    'terserOptions',
    'nameCache',
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

function cloneConfigValue(
  value: unknown,
  path: readonly PropertyKey[],
  seen: WeakMap<object, unknown>,
  isRoot = false,
): unknown {
  if (value == null || typeof value !== 'object') return value
  if (isPreservedState(path)) return value

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
          cloneConfigValue(descriptor.value, [...path, key], seen),
        )
      } else {
        Object.defineProperty(cloned, key, descriptor)
      }
    }
    return cloned
  }

  const isPlain = isPlainConfigObject(value)
  if (!isPlain && !isRoot) return value

  // Unknown plain objects with their own methods/accessors are treated as
  // behavior-bearing user values. Known option containers are still copied so
  // Vite and config hooks can safely normalize their fields.
  if (isPlain && !isConfigContainer(path) && hasOwnBehavior(value)) {
    return value
  }

  const cloned: Record<PropertyKey, unknown> = Object.create(
    Object.getPrototypeOf(value) == null ? null : Object.prototype,
  )
  seen.set(value, cloned)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) continue
    if ('value' in descriptor) {
      cloned[key] = cloneConfigValue(descriptor.value, [...path, key], seen)
    } else {
      Object.defineProperty(cloned, key, descriptor)
    }
  }
  return cloned
}

/**
 * Create the mutable working config used by `resolveConfig`.
 *
 * Configuration containers are detached from the caller input. Opaque runtime
 * objects and unknown behavior-bearing values retain their identity because
 * arbitrary JavaScript services cannot be cloned faithfully.
 */
export function cloneConfigForResolve<T>(config: T): T {
  return cloneConfigValue(config, [], new WeakMap(), true) as T
}
