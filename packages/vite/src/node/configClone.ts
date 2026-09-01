const configIdentityKeys = new Set([
  'customLogger',
  'customResolver',
  'nameCache',
])

function isPlainConfigObject(value: object): value is Record<string, unknown> {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype == null
}

function clonePluginOption(
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  const existing = seen.get(value)
  if (existing) {
    return existing
  }

  const cloned: unknown[] = []
  seen.set(value, cloned)
  for (const item of value) {
    cloned.push(clonePluginOption(item, seen))
  }
  return cloned
}

function cloneConfigValue(
  value: unknown,
  key: string | undefined,
  seen: WeakMap<object, unknown>,
  forceConfigContainer = false,
): unknown {
  if (value == null || typeof value !== 'object') {
    return value
  }

  // These values are service/plugin instances rather than config containers.
  // Keep their identity while still copying the arrays that contain plugins.
  if (key && configIdentityKeys.has(key)) {
    return value
  }

  if (value instanceof RegExp) {
    const cloned = new RegExp(value.source, value.flags)
    cloned.lastIndex = value.lastIndex
    return cloned
  }

  if (Array.isArray(value)) {
    if (key === 'plugins') {
      return clonePluginOption(value, seen)
    }

    const existing = seen.get(value)
    if (existing) {
      return existing
    }

    const cloned: unknown[] = []
    seen.set(value, cloned)
    for (const item of value) {
      cloned.push(cloneConfigValue(item, undefined, seen))
    }
    return cloned
  }

  // Buffers, URLs, HTTP servers/agents, class instances, and other opaque
  // nested user values keep their identity. The root value is known to be the
  // config container itself, so copy its enumerable fields even if a caller
  // supplied it through a custom prototype.
  if (
    !isPlainConfigObject(value) &&
    (!forceConfigContainer ||
      Object.prototype.toString.call(value) !== '[object Object]')
  ) {
    return value
  }

  const existing = seen.get(value)
  if (existing) {
    return existing
  }

  const configObject = value as Record<string, unknown>
  const cloned: Record<string, unknown> = Object.create(
    Object.getPrototypeOf(value),
  )
  seen.set(value, cloned)
  for (const property of Object.keys(configObject)) {
    cloned[property] = cloneConfigValue(configObject[property], property, seen)
  }
  return cloned
}

/**
 * Clone mutable config containers while retaining opaque user-owned values.
 *
 * This is intentionally different from `deepClone`: arbitrary Vite config can
 * contain plugin instances, resolver/logger services, Node objects, Buffers,
 * and other values that are meaningful by identity and cannot safely be rebuilt
 * as plain objects.
 */
export function cloneConfig<T>(config: T): T {
  return cloneConfigValue(config, undefined, new WeakMap(), true) as T
}
