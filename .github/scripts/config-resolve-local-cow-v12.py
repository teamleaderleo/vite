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
    """    resolvedConfig.optimizeDeps.rolldownOptions ??= {}
    resolvedConfig.optimizeDeps.rolldownOptions.plugins ||= []
    ;(resolvedConfig.optimizeDeps.rolldownOptions.plugins as any[]).push(
      ...resolvedConfig.optimizeDeps.esbuildOptions.plugins.map((plugin) =>
        convertEsbuildPluginToRolldownPlugin(plugin),
      ),
    )
""",
    """    resolvedConfig.optimizeDeps.rolldownOptions ??= {}
    const plugins = (
      resolvedConfig.optimizeDeps.rolldownOptions.plugins as any[] | undefined
    )?.slice() ?? []
    plugins.push(
      ...resolvedConfig.optimizeDeps.esbuildOptions.plugins.map((plugin) =>
        convertEsbuildPluginToRolldownPlugin(plugin),
      ),
    )
    resolvedConfig.optimizeDeps.rolldownOptions.plugins = plugins
""",
)

utils = 'packages/vite/src/node/utils.ts'
replace_once(
    utils,
    """  const merged: Record<string, any> = { ...environment }
  if (isObject(merged.build)) {
    setupRollupOptionCompat(merged.build, 'build')
  }
""",
    """  const merged: Record<string, any> = { ...environment }
  if (isObject(merged.build)) {
    merged.build = { ...merged.build }
    setupRollupOptionCompat(merged.build, 'build')
  }
""",
)

test = 'packages/vite/src/node/__tests__/configResolveInputOwnershipLocal.spec.ts'
replace_once(
    test,
    """import type { InlineConfig } from '..'
import { resolveConfig } from '../config'
""",
    """import type { InlineConfig } from '..'
import { resolveConfig } from '../config'
import { mergeConfig } from '../utils'
""",
)
replace_once(
    test,
    """test('keeps repeated config resolution idempotent', async () => {
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
""",
    """test('keeps repeated optimizer plugin compatibility idempotent', async () => {
  const optimizerPlugin = { name: 'test:resolve-config-idempotence' }
  const optimizerPlugins = [optimizerPlugin]
  Object.freeze(optimizerPlugins)
  const esbuildPlugin = {
    name: 'test:esbuild-compat',
    setup() {},
  }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      rolldownOptions: { plugins: optimizerPlugins },
      esbuildOptions: { plugins: [esbuildPlugin] },
    },
  }

  const first = await resolveConfig(inlineConfig, 'serve')
  const second = await resolveConfig(inlineConfig, 'serve')

  expect(first.environments.client.optimizeDepsPluginNames).toEqual([
    optimizerPlugin.name,
    esbuildPlugin.name,
  ])
  expect(second.environments.client.optimizeDepsPluginNames).toEqual([
    optimizerPlugin.name,
    esbuildPlugin.name,
  ])
  expect(optimizerPlugins).toEqual([optimizerPlugin])
})
""",
)

p = Path(test)
text = p.read_text()
text += """

test('keeps environment build compatibility writes out of merge overrides', () => {
  const build = Object.freeze({})
  const inlineConfig: InlineConfig = {
    environments: { client: { build } },
  }

  const merged = mergeConfig({}, inlineConfig)
  const mergedBuild = merged.environments.client.build!

  expect(mergedBuild).not.toBe(build)
  expect(
    Object.getOwnPropertyDescriptor(mergedBuild, 'rollupOptions')?.get,
  ).toBeTypeOf('function')
  expect(Object.getOwnPropertyDescriptor(build, 'rollupOptions')).toBeUndefined()
})
"""
p.write_text(text)
