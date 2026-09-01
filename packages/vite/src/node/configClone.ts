const preserveKeys = new Set(['customLogger', 'customResolver', 'nameCache'])

const preservePaths = new Set([
  'css.preprocessorOptions.scss.importer',
  'css.preprocessorOptions.sass.importer',
  'css.preprocessorOptions.scss.logger',
  'css.preprocessorOptions.sass.logger',
  'css.postcss.parser',
  'css.postcss.stringifier',
  'css.postcss.syntax',
  'css.lightningcss.visitor',
])

const preserveArrayEntries = new Set([
  'css.preprocessorOptions.scss.importers',
  'css.preprocessorOptions.sass.importers',
])

type ConfigPath = readonly PropertyKey[]

function pathName(path: ConfigPath): string {
  return path.every((part) => typeof part === 'string') ? path.join('.') : ''
}

function clonePluginOption(
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  if (!Array.isArray(value)) return value

  const existing = seen.get(value)
  if (existing) return existing

  const cloned: unknown[] = []
  seen.set(value, cloned)
  for (const item of value) cloned.push(clonePluginOption(item, seen))
  return cloned
}

function cloneConfigValue(
  value: unknown,
  path: ConfigPath,
  seen: WeakMap<object, unknown>,
  root = false,
): unknown {
  if (value == null || typeof value !== 'object') return value

  const key = path.at(-1)
  const namedPath = pathName(path)
  if (
    (typeof key === 'string' && preserveKeys.has(key)) ||
    preservePaths.has(namedPath)
  ) {
    return value
  }

  if (value instanceof RegExp) {
    const cloned = new RegExp(value.source, value.flags)
    cloned.lastIndex = value.lastIndex
    return cloned
  }

  if (Array.isArray(value)) {
    if (key === 'plugins') return clonePluginOption(value, seen)

    const existing = seen.get(value)
    if (existing) return existing

    const cloned: unknown[] = []
    seen.set(value, cloned)
    for (const item of value) {
      cloned.push(
        preserveArrayEntries.has(namedPath)
          ? item
          : cloneConfigValue(item, path, seen),
      )
    }
    return cloned
  }

  const prototype = Object.getPrototypeOf(value)
  const isPlainObject =
    Object.prototype.toString.call(value) === '[object Object]' &&
    (prototype === Object.prototype || prototype == null)
  if (!isPlainObject && !root) return value

  const existing = seen.get(value)
  if (existing) return existing

  const cloned: Record<PropertyKey, unknown> = Object.create(prototype)
  seen.set(value, cloned)
  for (const property of Reflect.ownKeys(value)) {
    if (!Object.getOwnPropertyDescriptor(value, property)?.enumerable) continue
    cloned[property] = cloneConfigValue(
      (value as Record<PropertyKey, unknown>)[property],
      [...path, property],
      seen,
    )
  }
  return cloned
}

export function cloneConfig<T>(config: T): T {
  return cloneConfigValue(config, [], new WeakMap(), true) as T
}
