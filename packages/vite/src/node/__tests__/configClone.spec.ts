import http from 'node:http'
import { expect, test } from 'vitest'
import { cloneConfig } from '../configClone'
import { deepClone, mergeConfig } from '../utils'

test('clones mutable config containers', () => {
  const config = { resolve: { conditions: ['source'] } }
  const cloned = cloneConfig(config)

  cloned.resolve.conditions.push('mutated')

  expect(cloned).not.toBe(config)
  expect(cloned.resolve).not.toBe(config.resolve)
  expect(cloned.resolve.conditions).not.toBe(config.resolve.conditions)
  expect(config.resolve.conditions).toEqual(['source'])
})

test('clones a custom-prototype config root without flattening its prototype', () => {
  class Config {
    logLevel = 'silent'
    resolve = { conditions: ['source'] }
  }

  const config = new Config()
  const cloned = cloneConfig(config)

  expect(cloned).not.toBe(config)
  expect(cloned).toBeInstanceOf(Config)
  expect(cloned.resolve).not.toBe(config.resolve)
})

test('copies plugin arrays while retaining plugin objects', () => {
  const plainPlugin = { name: 'test:plain-plugin' }
  class ClassPlugin {
    name = 'test:class-plugin'
    config() {}
  }
  const classPlugin = new ClassPlugin()
  const nestedPlugins = [classPlugin]
  const config = {
    plugins: [plainPlugin, nestedPlugins] as unknown[],
    optimizeDeps: { rolldownOptions: { plugins: [plainPlugin] } },
  }

  const cloned = cloneConfig(config)
  const clonedNestedPlugins = cloned.plugins[1] as unknown[]

  expect(cloned.plugins).not.toBe(config.plugins)
  expect(clonedNestedPlugins).not.toBe(nestedPlugins)
  expect(cloned.plugins[0]).toBe(plainPlugin)
  expect(clonedNestedPlugins[0]).toBe(classPlugin)
  expect(cloned.optimizeDeps.rolldownOptions.plugins).not.toBe(
    config.optimizeDeps.rolldownOptions.plugins,
  )
  expect(cloned.optimizeDeps.rolldownOptions.plugins[0]).toBe(plainPlugin)
})

test('retains opaque values and service-object identity', () => {
  const binary = Buffer.from([1, 2, 3])
  const logger = { info() {}, warn() {}, error() {} }
  const customResolver = { resolveId() {} }
  class CustomValue {
    value = 1
  }
  const custom = new CustomValue()
  const config = {
    customLogger: logger,
    resolve: {
      alias: [
        {
          find: 'source',
          replacement: 'replacement',
          customResolver,
        },
      ],
    },
    server: { https: { cert: binary } },
    experimental: { custom },
  }

  const cloned = cloneConfig(config)

  expect(cloned.customLogger).toBe(logger)
  expect(cloned.resolve.alias).not.toBe(config.resolve.alias)
  expect(cloned.resolve.alias[0]).not.toBe(config.resolve.alias[0])
  expect(cloned.resolve.alias[0].customResolver).toBe(customResolver)
  expect(cloned.server).not.toBe(config.server)
  expect(cloned.server.https).not.toBe(config.server.https)
  expect(cloned.server.https.cert).toBe(binary)
  expect(cloned.experimental.custom).toBe(custom)
})

test('mergeConfig with an empty base still shares unmatched nested config', () => {
  const config = { resolve: { conditions: ['source'] } }
  const merged = mergeConfig({}, config)

  merged.resolve.conditions.push('mutated')

  expect(merged.resolve).toBe(config.resolve)
  expect(config.resolve.conditions).toEqual(['source', 'mutated'])
})

test('existing deepClone rejects opaque inline-config values', () => {
  const cert = Buffer.from([1, 2, 3])

  expect(() => deepClone({ server: { https: { cert } } })).toThrow(
    'Cannot deep clone non-plain object',
  )
})

test('existing deepClone recreates caller-owned server instances', () => {
  const wsServer = http.createServer()
  const cloned = deepClone({ server: { ws: { server: wsServer } } })

  expect(cloned.server.ws.server).not.toBe(wsServer)
  expect(cloned.server.ws.server).not.toBeInstanceOf(http.Server)
})

test('existing deepClone clones plain custom logger identity', () => {
  const logger = {
    state: { count: 0 },
    info() {
      this.state.count++
    },
  }
  const cloned = deepClone({ customLogger: logger })

  expect(cloned.customLogger).not.toBe(logger)
  expect(cloned.customLogger.state).not.toBe(logger.state)
})

test('existing deepClone flattens class-based plugins', () => {
  class ClassPlugin {
    name = 'test:class-plugin'
    config() {}
  }
  const plugin = new ClassPlugin()
  const cloned = deepClone({ plugins: [plugin] })

  expect(cloned.plugins[0]).not.toBe(plugin)
  expect(cloned.plugins[0]).not.toBeInstanceOf(ClassPlugin)
  expect(cloned.plugins[0].config).toBeUndefined()
})

test('preserves regexp state while cloning regexp identity', () => {
  const pattern = /foo/gy
  pattern.lastIndex = 2
  const cloned = cloneConfig({ assetsInclude: pattern })

  expect(cloned.assetsInclude).not.toBe(pattern)
  expect(cloned.assetsInclude.source).toBe(pattern.source)
  expect(cloned.assetsInclude.flags).toBe(pattern.flags)
  expect(cloned.assetsInclude.lastIndex).toBe(2)
})

test('handles cycles between config containers', () => {
  const config: { nested: { root?: unknown } } = { nested: {} }
  config.nested.root = config
  const cloned = cloneConfig(config)

  expect(cloned).not.toBe(config)
  expect(cloned.nested).not.toBe(config.nested)
  expect(cloned.nested.root).toBe(cloned)
})
