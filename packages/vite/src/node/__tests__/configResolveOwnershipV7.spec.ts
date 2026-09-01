import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

test('isolates nested rolldown treeshake option bags with callbacks', async () => {
  const treeshake: any = {
    moduleSideEffects() {
      return true
    },
  }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    build: { rolldownOptions: { treeshake } },
    plugins: [
      {
        name: 'test:mutate-treeshake-options',
        config(config) {
          const options = config.build?.rolldownOptions?.treeshake
          if (options && typeof options === 'object') {
            options.propertyReadSideEffects = false
          }
        },
      },
    ],
  }

  await resolveConfig(inlineConfig, 'build')

  expect('propertyReadSideEffects' in treeshake).toBe(false)
})

test('isolates nested PostCSS map option bags with callbacks', async () => {
  const map: any = {
    prev() {
      return ''
    },
  }
  const postcss: any = { map }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    css: { postcss },
    plugins: [
      {
        name: 'test:mutate-postcss-map-options',
        config(config) {
          const map = (config.css?.postcss as any)?.map
          if (map && typeof map === 'object') map.inline = true
        },
      },
    ],
  }

  await resolveConfig(inlineConfig, 'serve')

  expect('inline' in map).toBe(false)
})

test('isolates Sass function maps while preserving callback identity', async () => {
  const sum = () => null
  const functions: any = { 'sum($a, $b)': sum }
  const scss: any = { functions }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    css: { preprocessorOptions: { scss } },
    plugins: [
      {
        name: 'test:mutate-sass-functions',
        config(config) {
          const functions = (config.css?.preprocessorOptions?.scss as any)
            ?.functions
          if (functions) functions['other()'] = () => null
        },
      },
    ],
  }

  const resolved = await resolveConfig(inlineConfig, 'serve')

  expect('other()' in functions).toBe(false)
  expect(
    (resolved.css.preprocessorOptions?.scss as any).functions['sum($a, $b)'],
  ).toBe(sum)
})
