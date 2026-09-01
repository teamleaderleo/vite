import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

test('preserves nested plugin-defined service objects', async () => {
  const service = {
    calls: 0,
    bump() {
      this.calls++
    },
  }
  const inlineConfig = {
    configFile: false,
    logLevel: 'silent',
    server: { customService: service },
    plugins: [
      {
        name: 'test:nested-service',
        config(config: any) {
          config.server.customService.bump()
        },
      },
    ],
  } satisfies InlineConfig & {
    server: NonNullable<InlineConfig['server']> & {
      customService: typeof service
    }
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(service.calls).toBe(1)
  expect((resolved.server as any).customService).toBe(service)
})

test('isolates terser format bags while preserving callback identity', async () => {
  const comments = () => true
  const format: any = { comments }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    build: { terserOptions: { format } },
    plugins: [
      {
        name: 'test:mutate-terser-format',
        config(config) {
          ;(config.build?.terserOptions as any).format.beautify = true
        },
      },
    ],
  }

  const resolved = await resolveConfig(inlineConfig, 'build')

  expect(format.beautify).toBeUndefined()
  expect((resolved.build.terserOptions.format as any).comments).toBe(comments)
})

test('isolates Stylus function maps while preserving callback identity', async () => {
  const double = () => null
  const functions: any = { double }
  const stylus: any = { functions }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    css: { preprocessorOptions: { stylus } },
    plugins: [
      {
        name: 'test:mutate-stylus-functions',
        config(config) {
          const functions = (config.css?.preprocessorOptions?.stylus as any)
            ?.functions
          if (functions) functions.other = () => null
        },
      },
    ],
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect(functions.other).toBeUndefined()
  expect(
    (resolved.css.preprocessorOptions?.stylus as any).functions.double,
  ).toBe(double)
})
