import type { RolldownOptions } from 'rolldown'
import type { InlineConfig } from './config'
import type { DepOptimizationOptions } from './optimizer'

function cloneOptionObject<T extends object>(value: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(value)), value)
}

function cloneRolldownOptionsForResolve<T extends RolldownOptions>(
  options: T,
): T {
  const cloned = cloneOptionObject(options)

  if (options.resolve) cloned.resolve = cloneOptionObject(options.resolve)
  if (options.transform) cloned.transform = cloneOptionObject(options.transform)
  if (options.moduleTypes)
    cloned.moduleTypes = cloneOptionObject(options.moduleTypes)

  if (options.output && !Array.isArray(options.output)) {
    cloned.output = cloneOptionObject(options.output)
    if (Array.isArray(options.output.plugins)) {
      cloned.output.plugins = [...options.output.plugins]
    }
  }

  if (Array.isArray(options.plugins)) {
    cloned.plugins = [...options.plugins]
  }

  return cloned
}

function cloneDepOptimizationOptionsForResolve<
  T extends DepOptimizationOptions,
>(options: T): T {
  const cloned = cloneOptionObject(options)

  if (options.esbuildOptions) {
    cloned.esbuildOptions = cloneOptionObject(options.esbuildOptions)
  }

  if (options.rolldownOptions) {
    cloned.rolldownOptions = cloneRolldownOptionsForResolve(
      options.rolldownOptions,
    )
  }

  if (options.rollupOptions) {
    cloned.rollupOptions =
      options.rollupOptions === options.rolldownOptions
        ? cloned.rolldownOptions
        : cloneRolldownOptionsForResolve(options.rollupOptions)
  }

  return cloned
}

function cloneEnvironmentForResolve<
  T extends NonNullable<InlineConfig['environments']>[string],
>(environment: T): T {
  const cloned = cloneOptionObject(environment)

  if (environment.dev) cloned.dev = cloneOptionObject(environment.dev)
  if (environment.build) cloned.build = cloneOptionObject(environment.build)
  if (environment.optimizeDeps) {
    cloned.optimizeDeps = cloneDepOptimizationOptionsForResolve(
      environment.optimizeDeps,
    )
  }

  return cloned
}

/**
 * Create the mutable working config used by `resolveConfig`.
 *
 * This intentionally copies only containers that Vite itself writes to while
 * resolving config. Arbitrary nested user values remain opaque and keep their
 * identity; in particular, this does not try to classify third-party plain
 * objects as either configuration data or runtime services.
 */
export function cloneConfigForResolve(config: InlineConfig): InlineConfig {
  const cloned = cloneOptionObject(config)

  if (config.build) cloned.build = cloneOptionObject(config.build)
  if (config.worker) cloned.worker = cloneOptionObject(config.worker)
  if (config.resolve) cloned.resolve = cloneOptionObject(config.resolve)

  if (config.optimizeDeps) {
    cloned.optimizeDeps = cloneDepOptimizationOptionsForResolve(
      config.optimizeDeps,
    )
  }

  if (config.ssr) {
    cloned.ssr = cloneOptionObject(config.ssr)
    if (config.ssr.optimizeDeps) {
      cloned.ssr.optimizeDeps = cloneDepOptimizationOptionsForResolve(
        config.ssr.optimizeDeps,
      )
    }
  }

  if (config.server) {
    cloned.server = cloneOptionObject(config.server)
    if (config.server.hmr && typeof config.server.hmr === 'object') {
      cloned.server.hmr = cloneOptionObject(config.server.hmr)
    }
    if (Array.isArray(config.server.allowedHosts)) {
      cloned.server.allowedHosts = [...config.server.allowedHosts]
    }
  }

  if (config.preview) {
    cloned.preview = cloneOptionObject(config.preview)
    if (Array.isArray(config.preview.allowedHosts)) {
      cloned.preview.allowedHosts = [...config.preview.allowedHosts]
    }
  }

  if (config.css) {
    cloned.css = cloneOptionObject(config.css)
    if (config.css.lightningcss) {
      cloned.css.lightningcss = cloneOptionObject(config.css.lightningcss)
    }
  }

  if (config.environments) {
    cloned.environments = cloneOptionObject(config.environments)
    for (const [name, environment] of Object.entries(config.environments)) {
      cloned.environments[name] = cloneEnvironmentForResolve(environment)
    }
  }

  return cloned
}
