import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

test('isolates commonjs options while preserving callbacks', async () => {
  const ignore = () => true
  const commonjsOptions = { ignore }
  const inlineConfig: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    build: { commonjsOptions },
    plugins: [
      {
        name: 'test:mutate-commonjs-options',
        config(config) {
          config.build!.commonjsOptions!.ignoreGlobal = true
        },
      },
    ],
  }

  const resolved = await resolveConfig(inlineConfig, 'build')

  expect(commonjsOptions.ignoreGlobal).toBeUndefined()
  expect(resolved.build.commonjsOptions.ignore).toBe(ignore)
})
