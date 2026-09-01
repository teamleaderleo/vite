import { expect, test } from 'vitest'
import type { InlineConfig } from '..'
import { resolveConfig } from '../config'

test('preserves third-party imperative option object identity', async () => {
  const entryImporter = {
    canonicalize() {
      return null
    },
    load() {
      return null
    },
  }
  const importer = {
    canonicalize() {
      return null
    },
    load() {
      return null
    },
  }
  const sassLogger = {
    warn() {
      return undefined
    },
    debug() {
      return undefined
    },
  }
  const postcssSyntax = {
    parse() {
      return undefined
    },
    stringify() {
      return undefined
    },
  }
  const lightningVisitor = {
    Declaration() {
      return undefined
    },
  }

  const inlineConfig = {
    configFile: false,
    logLevel: 'silent',
    css: {
      preprocessorOptions: {
        scss: {
          importer: entryImporter,
          importers: [importer],
          logger: sassLogger,
        },
      },
      postcss: {
        parser: postcssSyntax,
        stringifier: postcssSyntax,
        syntax: postcssSyntax,
      },
      lightningcss: {
        visitor: lightningVisitor,
      },
    },
  } as InlineConfig

  const resolved = await resolveConfig(inlineConfig, 'serve')
  const css = resolved.css as any

  expect(css.preprocessorOptions.scss.importer).toBe(entryImporter)
  expect(css.preprocessorOptions.scss.importers[0]).toBe(importer)
  expect(css.preprocessorOptions.scss.logger).toBe(sassLogger)
  expect(css.postcss.parser).toBe(postcssSyntax)
  expect(css.postcss.stringifier).toBe(postcssSyntax)
  expect(css.postcss.syntax).toBe(postcssSyntax)
  expect(css.lightningcss.visitor).toBe(lightningVisitor)
})
