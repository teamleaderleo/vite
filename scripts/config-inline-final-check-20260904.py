from pathlib import Path

root = Path('packages/vite/src/node/__tests__')
inline = root / 'configResolveInlineConfig.spec.ts'
text = inline.read_text()
assert "test('retries resolution after a config hook fails'" not in text
text += '''

test.each(['config', 'configEnvironment'] as const)(
  'copies optimizer options supplied by the %s hook before normalization',
  async (phase) => {
    const transform = Object.freeze({})
    const moduleTypes = Object.freeze({})
    const rolldownOptions = Object.freeze({ transform, moduleTypes })
    const optimizeDeps = Object.freeze({
      rolldownOptions,
      esbuildOptions: Object.freeze({
        define: { __HOOK__: 'true' },
        loader: { '.txt': 'text' as const },
      }),
    })
    const hook = vi.fn()
    const resolved = await resolveConfig(
      {
        configFile: false,
        envDir: false,
        logLevel: 'silent',
        plugins: [
          {
            name: 'test:hook-options',
            config() {
              if (phase === 'config') {
                hook()
                return { optimizeDeps }
              }
            },
            configEnvironment(name) {
              if (phase === 'configEnvironment' && name === 'client') {
                hook()
                return { optimizeDeps }
              }
            },
          },
        ],
      },
      'serve',
    )

    expect(hook).toHaveBeenCalledOnce()
    expect(transform).toEqual({})
    expect(moduleTypes).toEqual({})
    expect(resolved.optimizeDeps.rolldownOptions?.transform?.define).toEqual({
      __HOOK__: 'true',
    })
    expect(resolved.optimizeDeps.rolldownOptions?.moduleTypes).toEqual({
      '.txt': 'text',
    })
  },
)

test('resolves shared optimizer options independently for each environment', async () => {
  const resolve = Object.freeze({})
  const output = Object.freeze({})
  const rolldownOptions = Object.freeze({ resolve, output })
  const optimizeDeps = Object.freeze({ rolldownOptions })
  const resolved = await resolveConfig(
    {
      configFile: false,
      envDir: false,
      logLevel: 'silent',
      optimizeDeps,
      environments: {
        ssr: {
          optimizeDeps: {
            ...optimizeDeps,
            esbuildOptions: { preserveSymlinks: true },
          },
        },
        custom: { optimizeDeps },
      },
    },
    'serve',
  )

  expect(resolve).toEqual({})
  expect(output).toEqual({})
  expect(resolved.optimizeDeps).toBe(resolved.environments.client.optimizeDeps)
  expect(resolved.optimizeDeps.rolldownOptions?.resolve?.symlinks).toBe(true)
  expect(resolved.environments.ssr.optimizeDeps.rolldownOptions?.resolve?.symlinks).toBe(false)
  expect(resolved.environments.custom.optimizeDeps.rolldownOptions?.resolve?.symlinks).toBe(true)
  expect(resolved.environments.ssr.optimizeDeps.rolldownOptions).not.toBe(
    resolved.environments.custom.optimizeDeps.rolldownOptions,
  )
})

test('retries resolution after a config hook fails', async () => {
  const failure = new Error('config hook failed')
  const build = Object.freeze({})
  const hook = vi.fn().mockImplementationOnce(() => {
    throw failure
  })
  const inlineConfig: InlineConfig = {
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    build,
    plugins: [{ name: 'test:retry-config', config: hook }],
  }

  await expect(resolveConfig(inlineConfig, 'serve')).rejects.toBe(failure)
  expect(Object.getOwnPropertyDescriptor(build, 'rollupOptions')).toBeUndefined()
  const resolved = await resolveConfig(inlineConfig, 'serve')
  expect(hook).toHaveBeenCalledTimes(2)
  expect(resolved.inlineConfig).toBe(inlineConfig)
  expect(resolved.build.rollupOptions).toBe(resolved.build.rolldownOptions)
  expect(Object.getOwnPropertyDescriptor(build, 'rollupOptions')).toBeUndefined()
})
'''
inline.write_text(text)

config = root / 'config.spec.ts'
text = config.read_text()
old = "  test('keeps environment build compatibility writes out of merge overrides', () => {"
assert text.count(old) == 1
text = text.replace(old, "  test.each([{}, { environments: {} }, { environments: { client: {} } }])(\n    'keeps environment build compatibility writes out of merge overrides with defaults %j',\n    (defaults) => {", 1)
old = "    const merged = mergeConfig({}, inlineConfig)\n"
assert text.count(old) == 1
text = text.replace(old, "    const merged = mergeConfig(defaults, inlineConfig)\n", 1)
anchor = "  test('syncs `server.hmr.*` to `server.ws.*`', () => {"
assert text.count(anchor) == 1
text = text.replace(anchor, '''  test('keeps HMR compatibility writes in the merged server options', () => {
    const hmr = Object.freeze({ port: 24678, overlay: false })
    const server = Object.freeze({ hmr })
    const merged = mergeConfig(
      { server },
      { server: { ws: { port: 24679 } } },
    )
    const next = mergeConfig(merged, { server: { ws: { port: 24680 } } })

    expect(hmr.port).toBe(24678)
    expect(Object.getOwnPropertyDescriptor(hmr, 'port')?.get).toBeUndefined()
    expect('ws' in server).toBe(false)
    expect(merged.server.hmr.port).toBe(24679)
    expect(next.server.hmr.port).toBe(24680)
    expect(next.server.hmr.overlay).toBe(false)
    next.server.ws.port = 24681
    expect(next.server.hmr.port).toBe(24681)
    expect(merged.server.hmr.port).toBe(24679)
  })

''' + anchor, 1)
config.write_text(text)

restart = root / 'optimizer/configRestart.spec.ts'
assert not restart.exists()
restart.write_text('''import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import type { InlineConfig, ViteDevServer } from '../..'
import { createServer } from '../..'

test('reuses the optimizer cache on restart and invalidates it when plugins change', async () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vite-config-restart-'),
  )
  const depDir = path.join(root, 'node_modules', 'restart-dep')
  fs.mkdirSync(depDir, { recursive: true })
  fs.writeFileSync(
    path.join(depDir, 'package.json'),
    JSON.stringify({ name: 'restart-dep', type: 'module', main: 'index.js' }),
  )
  fs.writeFileSync(path.join(depDir, 'index.js'), 'export const value = 1')

  const buildStart = vi.fn()
  const optimizerPlugin = { name: 'test:restart-optimizer', buildStart }
  const optimizerPlugins = [optimizerPlugin]
  Object.freeze(optimizerPlugins)
  const esbuildPlugin = {
    name: 'test:restart-esbuild',
    setup() {},
  }
  const inlineConfig: InlineConfig = {
    root,
    cacheDir: path.join(root, '.vite'),
    configFile: false,
    envDir: false,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: {
      noDiscovery: true,
      include: ['restart-dep'],
      rolldownOptions: { plugins: optimizerPlugins },
      esbuildOptions: { plugins: [esbuildPlugin] },
    },
  }
  let server: ViteDevServer | undefined
  try {
    server = await createServer(inlineConfig)
    const first = server.environments.client.depsOptimizer!.metadata
    expect(first.optimized['restart-dep']).toBeDefined()
    expect(fs.existsSync(first.optimized['restart-dep'].file)).toBe(true)
    expect(buildStart).toHaveBeenCalled()
    buildStart.mockClear()

    await server.restart()
    const second = server.environments.client.depsOptimizer!.metadata
    expect(server.config.inlineConfig).toBe(inlineConfig)
    expect(second.configHash).toBe(first.configHash)
    expect(second.hash).toBe(first.hash)
    expect(second.browserHash).toBe(first.browserHash)
    expect(second.optimized['restart-dep'].file).toBe(first.optimized['restart-dep'].file)
    expect(buildStart).not.toHaveBeenCalled()
    expect(optimizerPlugins).toEqual([optimizerPlugin])
    expect(server.config.environments.client.optimizeDepsPluginNames).toEqual([
      optimizerPlugin.name,
      esbuildPlugin.name,
    ])

    inlineConfig.optimizeDeps = {
      ...inlineConfig.optimizeDeps,
      rolldownOptions: {
        plugins: [{ ...optimizerPlugin, name: 'test:changed-optimizer' }],
      },
    }
    await server.restart()
    const third = server.environments.client.depsOptimizer!.metadata
    expect(third.configHash).not.toBe(first.configHash)
    expect(buildStart).toHaveBeenCalled()
    expect(third.optimized['restart-dep']).toBeDefined()
    expect(optimizerPlugins).toEqual([optimizerPlugin])
  } finally {
    try {
      await server?.close()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})
''')
