from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}')
    p.write_text(text.replace(old, new, 1))


config = 'packages/vite/src/node/config.ts'
replace_once(
    config,
    """  let config = inlineConfig
  config.build ??= {}
  setupRollupOptionCompat(config.build, 'build')
  config.worker ??= {}
  setupRollupOptionCompat(config.worker, 'worker')
  config.optimizeDeps ??= {}
  setupRollupOptionCompat(config.optimizeDeps, 'optimizeDeps')
  if (config.ssr) {
    config.ssr.optimizeDeps ??= {}
    setupRollupOptionCompat(config.ssr.optimizeDeps, 'ssr.optimizeDeps')
  }
""",
    """  let config: InlineConfig = { ...inlineConfig }
  config.build = { ...config.build }
  setupRollupOptionCompat(config.build, 'build')
  config.worker = { ...config.worker }
  setupRollupOptionCompat(config.worker, 'worker')
  config.optimizeDeps = { ...config.optimizeDeps }
  setupRollupOptionCompat(config.optimizeDeps, 'optimizeDeps')
  if (config.ssr) {
    config.ssr = { ...config.ssr }
    config.ssr.optimizeDeps = { ...config.ssr.optimizeDeps }
    setupRollupOptionCompat(config.ssr.optimizeDeps, 'ssr.optimizeDeps')
  }
""",
)

replace_once(
    config,
    """  if (
    optimizeDeps?.rolldownOptions &&
    optimizeDeps?.rolldownOptions === optimizeDeps?.rollupOptions
  ) {
    delete optimizeDeps?.rollupOptions
  }
  const merged = mergeWithDefaults(
""",
    """  const hasRollupOptionCompatProxy =
    !!optimizeDeps?.rolldownOptions &&
    optimizeDeps.rolldownOptions === optimizeDeps.rollupOptions
  const merged = mergeWithDefaults(
""",
)

replace_once(
    config,
    """    optimizeDeps ?? {},
  )
  setupRollupOptionCompat(merged, 'optimizeDeps')

  const rolldownOptions = merged.rolldownOptions as Exclude<
""",
    """    optimizeDeps ?? {},
  )
  if (hasRollupOptionCompatProxy) {
    merged.rollupOptions = merged.rolldownOptions
  }
  setupRollupOptionCompat(merged, 'optimizeDeps')

  merged.rolldownOptions = { ...merged.rolldownOptions }
  const rolldownOptions = merged.rolldownOptions as Exclude<
""",
)

replace_once(
    config,
    """    undefined
  >

  if (merged.esbuildOptions && Object.keys(merged.esbuildOptions).length > 0) {
""",
    """    undefined
  >
  rolldownOptions.resolve = { ...rolldownOptions.resolve }
  rolldownOptions.output = { ...rolldownOptions.output }

  if (merged.esbuildOptions && Object.keys(merged.esbuildOptions).length > 0) {
""",
)

replace_once(
    config,
    """    rolldownOptions.resolve ??= {}
    rolldownOptions.output ??= {}
    rolldownOptions.transform ??= {}
""",
    """    rolldownOptions.transform ??= {}
""",
)

replace_once(
    config,
    """    if (
      merged.esbuildOptions.define !== undefined &&
      rolldownOptions.transform.define === undefined
    ) {
      rolldownOptions.transform.define = merged.esbuildOptions.define
    }
""",
    """    if (
      merged.esbuildOptions.define !== undefined &&
      rolldownOptions.transform.define === undefined
    ) {
      rolldownOptions.transform = {
        ...rolldownOptions.transform,
        define: merged.esbuildOptions.define,
      }
    }
""",
)

replace_once(
    config,
    """    if (merged.esbuildOptions.loader !== undefined) {
      const loader = merged.esbuildOptions.loader
      rolldownOptions.moduleTypes ??= {}
      for (const [key, value] of Object.entries(loader)) {
        if (
          rolldownOptions.moduleTypes[key] === undefined &&
""",
    """    if (merged.esbuildOptions.loader !== undefined) {
      const loader = merged.esbuildOptions.loader
      const moduleTypes = (rolldownOptions.moduleTypes = {
        ...rolldownOptions.moduleTypes,
      })
      for (const [key, value] of Object.entries(loader)) {
        if (
          moduleTypes[key] === undefined &&
""",
)

replace_once(
    config,
    """          rolldownOptions.moduleTypes[key] = value
""",
    """          moduleTypes[key] = value
""",
)

replace_once(
    config,
    """  merged.esbuildOptions ??= {}
  merged.esbuildOptions.preserveSymlinks ??= preserveSymlinks

  rolldownOptions.resolve ??= {}
  rolldownOptions.resolve.symlinks ??= !preserveSymlinks
  rolldownOptions.output ??= {}
  rolldownOptions.output.topLevelVar ??= true
""",
    """  merged.esbuildOptions = { ...merged.esbuildOptions }
  merged.esbuildOptions.preserveSymlinks ??= preserveSymlinks

  rolldownOptions.resolve.symlinks ??= !preserveSymlinks
  rolldownOptions.output.topLevelVar ??= true
""",
)

replace_once(
    config,
    """  // Ensure default client and ssr environments
  // If there are present, ensure order { client, ssr, ...custom }
  config.environments ??= {}
""",
    """  // Ensure default client and ssr environments
  // If there are present, ensure order { client, ssr, ...custom }
  // Vite replaces environment entries below, so own the map after config hooks.
  config.environments = { ...config.environments }
""",
)

replace_once(
    config,
    """  const configEnvironmentsClient = config.environments!.client!
  configEnvironmentsClient.dev ??= {}

  const deprecatedSsrOptimizeDepsConfig = config.ssr?.optimizeDeps ?? {}
  let configEnvironmentsSsr = config.environments!.ssr
""",
    """  const configEnvironmentsClient = (config.environments!.client = {
    ...config.environments!.client!,
  })
  configEnvironmentsClient.dev ??= {}

  const deprecatedSsrOptimizeDepsConfig = config.ssr?.optimizeDeps ?? {}
  let configEnvironmentsSsr = config.environments!.ssr
  if (configEnvironmentsSsr) {
    configEnvironmentsSsr = config.environments!.ssr = {
      ...configEnvironmentsSsr,
    }
  }
""",
)

replace_once(
    config,
    """  if (warmupOptions?.clientFiles) {
    configEnvironmentsClient.dev.warmup = warmupOptions.clientFiles
  }
""",
    """  if (warmupOptions?.clientFiles) {
    configEnvironmentsClient.dev = {
      ...configEnvironmentsClient.dev,
      warmup: warmupOptions.clientFiles,
    }
  }
""",
)

replace_once(
    config,
    """  if (warmupOptions?.ssrFiles) {
    configEnvironmentsSsr ??= {}
    configEnvironmentsSsr.dev ??= {}
    configEnvironmentsSsr.dev.warmup = warmupOptions.ssrFiles
  }
""",
    """  if (warmupOptions?.ssrFiles) {
    configEnvironmentsSsr ??= {}
    configEnvironmentsSsr.dev = {
      ...configEnvironmentsSsr.dev,
      warmup: warmupOptions.ssrFiles,
    }
  }
""",
)

replace_once(
    config,
    """  if (config.build?.ssrEmitAssets !== undefined) {
    configEnvironmentsSsr ??= {}
    configEnvironmentsSsr.build ??= {}
    configEnvironmentsSsr.build.emitAssets = config.build.ssrEmitAssets
  }
""",
    """  if (config.build?.ssrEmitAssets !== undefined) {
    configEnvironmentsSsr ??= {}
    configEnvironmentsSsr.build = {
      ...configEnvironmentsSsr.build,
      emitAssets: config.build.ssrEmitAssets,
    }
  }
""",
)

replace_once(
    config,
    """  // Backward compatibility: merge config.environments.client.resolve back into config.resolve
  config.resolve ??= {}
  config.resolve.conditions = config.environments.client.resolve?.conditions
""",
    """  // Backward compatibility: merge config.environments.client.resolve back into config.resolve
  config.resolve = { ...config.resolve }
  config.resolve.conditions = config.environments.client.resolve?.conditions
""",
)

utils = 'packages/vite/src/node/utils.ts'
replace_once(
    utils,
    """  if (serverConfig.hmr === true) {
    serverConfig.hmr = {}
  }

  const hmrConfig = serverConfig.hmr
""",
    """  if (serverConfig.hmr === true) {
    serverConfig.hmr = {}
  } else if (serverConfig.hmr) {
    serverConfig.hmr = { ...serverConfig.hmr }
  }

  const hmrConfig = serverConfig.hmr
""",
)

server = 'packages/vite/src/node/server/index.ts'
replace_once(
    server,
    """  const server: ResolvedServerOptions = {
    ..._server,
    fs: {
      ..._server.fs,
      // run searchForWorkspaceRoot only if needed
      allow: raw?.fs?.allow ?? [workspaceRoot],
    },
""",
    """  const server: ResolvedServerOptions = {
    ..._server,
    allowedHosts: Array.isArray(_server.allowedHosts)
      ? _server.allowedHosts.slice()
      : _server.allowedHosts,
    fs: {
      ..._server.fs,
      // run searchForWorkspaceRoot only if needed
      allow: raw?.fs?.allow ? raw.fs.allow.slice() : [workspaceRoot],
    },
""",
)

preview = 'packages/vite/src/node/preview.ts'
replace_once(
    preview,
    """    allowedHosts: preview?.allowedHosts ?? server.allowedHosts,
""",
    """    allowedHosts: Array.isArray(preview?.allowedHosts)
      ? preview.allowedHosts.slice()
      : (preview?.allowedHosts ?? server.allowedHosts),
""",
)

css = 'packages/vite/src/node/plugins/css.ts'
replace_once(
    css,
    """  if (resolved.transformer === 'lightningcss') {
    resolved.lightningcss ??= {}
    resolved.lightningcss.targets ??= convertTargets(
      ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET,
    )
  }
""",
    """  if (
    resolved.transformer === 'lightningcss' &&
    resolved.lightningcss?.targets === undefined
  ) {
    resolved.lightningcss = {
      ...resolved.lightningcss,
      targets: convertTargets(ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET),
    }
  }
""",
)

test_path = Path(
    'packages/vite/src/node/__tests__/configResolveInputOwnershipLocal.spec.ts'
)
test_path.write_text(
    r'''import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

test('keeps repeated config resolution idempotent', async () => {
  const optimizerPlugin = { name: 'test:resolve-config-idempotence' }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      rolldownOptions: { plugins: [optimizerPlugin] },
    },
  }

  const first = await resolveConfig(inlineConfig, 'serve')
  const second = await resolveConfig(inlineConfig, 'serve')

  expect(first.environments.client.optimizeDepsPluginNames).toEqual([
    optimizerPlugin.name,
  ])
  expect(second.environments.client.optimizeDepsPluginNames).toEqual([
    optimizerPlugin.name,
  ])
})

test('resolves frozen early compatibility option bags without mutating them', async () => {
  const build = Object.freeze({})
  const worker = Object.freeze({})
  const rolldownOptions = Object.freeze({})
  const optimizeDeps = Object.freeze({ rolldownOptions })
  const ssr = Object.freeze({})
  const inlineConfig = Object.freeze({
    configFile: false,
    logLevel: 'silent' as const,
    build,
    worker,
    optimizeDeps,
    ssr,
  })

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.inlineConfig).toBe(inlineConfig)
  expect(Object.getOwnPropertyDescriptor(build, 'rollupOptions')).toBeUndefined()
  expect(Object.getOwnPropertyDescriptor(worker, 'rollupOptions')).toBeUndefined()
  expect(
    Object.getOwnPropertyDescriptor(optimizeDeps, 'rollupOptions'),
  ).toBeUndefined()
  expect('optimizeDeps' in ssr).toBe(false)
})

test('does not copy late-owned config containers before config hooks', async () => {
  const server = { port: 5173 }
  const preview = { port: 4173 }
  const css = { devSourcemap: true }
  const resolve = { conditions: ['source'] }
  const environments = { client: {} }
  let getterCalls = 0
  Object.defineProperty(server, 'frameworkService', {
    enumerable: true,
    get() {
      getterCalls++
      return { value: 1 }
    },
  })

  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server,
    preview,
    css,
    resolve,
    environments,
    plugins: [
      {
        name: 'test:late-owned-identity',
        config(config) {
          expect(config.server).toBe(server)
          expect(config.preview).toBe(preview)
          expect(config.css).toBe(css)
          expect(config.resolve).toBe(resolve)
          expect(config.environments).toBe(environments)
          expect(getterCalls).toBe(0)
        },
      },
    ],
  }

  await resolveConfig(inlineConfig, 'serve')
})

test('keeps environment normalization writes out of frozen caller objects', async () => {
  const clientDev = Object.freeze({})
  const client = Object.freeze({ dev: clientDev })
  const ssrDev = Object.freeze({})
  const ssrBuild = Object.freeze({})
  const ssr = Object.freeze({ dev: ssrDev, build: ssrBuild })
  const environments = Object.freeze({ client, ssr })
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server: {
      warmup: {
        clientFiles: ['src/client.ts'],
        ssrFiles: ['src/ssr.ts'],
      },
    },
    build: { ssrEmitAssets: true },
    environments,
  }

  await resolveConfig(inlineConfig, 'serve')

  expect('warmup' in clientDev).toBe(false)
  expect('warmup' in ssrDev).toBe(false)
  expect('emitAssets' in ssrBuild).toBe(false)
  expect(environments.client).toBe(client)
  expect(environments.ssr).toBe(ssr)
})

test('keeps server, preview, css, and fs resolver writes out of caller leaves', async () => {
  const hmr = Object.freeze({ port: 24678 })
  const allowedHosts = ['server.example.test']
  const previewAllowedHosts = ['preview.example.test']
  const fsAllow = ['/project']
  Object.freeze(allowedHosts)
  Object.freeze(previewAllowedHosts)
  Object.freeze(fsAllow)
  const lightningcss = Object.freeze({})
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server: { hmr, allowedHosts, fs: { allow: fsAllow } },
    preview: { allowedHosts: previewAllowedHosts },
    css: { transformer: 'lightningcss', lightningcss },
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(Object.getOwnPropertyDescriptor(hmr, 'port')?.get).toBeUndefined()
  expect(allowedHosts).toEqual(['server.example.test'])
  expect(previewAllowedHosts).toEqual(['preview.example.test'])
  expect(fsAllow).toEqual(['/project'])
  expect('targets' in lightningcss).toBe(false)
  expect(resolved.server.allowedHosts).not.toBe(allowedHosts)
  expect(resolved.preview.allowedHosts).not.toBe(previewAllowedHosts)
  expect(resolved.server.fs.allow).not.toBe(fsAllow)
  expect(resolved.css.lightningcss).not.toBe(lightningcss)
})

test('keeps dependency optimizer writes out of frozen nested option bags', async () => {
  const resolve = Object.freeze({})
  const output = Object.freeze({})
  const rolldownOptions = Object.freeze({ resolve, output })
  const esbuildOptions = Object.freeze({ minify: true })
  const optimizeDeps = Object.freeze({ rolldownOptions, esbuildOptions })
  const envResolve = Object.freeze({})
  const envOutput = Object.freeze({})
  const envRolldownOptions = Object.freeze({
    resolve: envResolve,
    output: envOutput,
  })
  const envOptimizeDeps = Object.freeze({
    rolldownOptions: envRolldownOptions,
    esbuildOptions: Object.freeze({ minify: true }),
  })

  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
    environments: {
      client: { optimizeDeps: envOptimizeDeps },
    },
  }

  await resolveConfig(inlineConfig, 'serve')

  expect('symlinks' in resolve).toBe(false)
  expect('topLevelVar' in output).toBe(false)
  expect('preserveSymlinks' in esbuildOptions).toBe(false)
  expect('symlinks' in envResolve).toBe(false)
  expect('topLevelVar' in envOutput).toBe(false)
})

test('preserves rollupOptions and rolldownOptions compatibility aliasing', async () => {
  const rolldownOptions = {}
  const optimizeDeps = {
    rolldownOptions,
    rollupOptions: rolldownOptions,
  }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps,
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(resolved.optimizeDeps.rollupOptions).toBe(
    resolved.optimizeDeps.rolldownOptions,
  )
  expect(optimizeDeps.rolldownOptions).toBe(rolldownOptions)
  expect(optimizeDeps.rollupOptions).toBe(rolldownOptions)
})
'''
)
