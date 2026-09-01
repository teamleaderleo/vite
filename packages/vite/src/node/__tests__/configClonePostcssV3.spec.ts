import { expect, test } from 'vitest'
import { cloneConfigForResolve } from '../configClone'

test('preserves stateful PostCSS syntax services', () => {
  const syntax = {
    calls: 0,
    parse() {
      this.calls++
    },
    stringify() {
      this.calls++
    },
  }
  const postcss = { syntax }

  const cloned = cloneConfigForResolve({ css: { postcss } })

  expect(cloned.css.postcss).not.toBe(postcss)
  expect(cloned.css.postcss.syntax).toBe(syntax)
  cloned.css.postcss.syntax.parse()
  expect(syntax.calls).toBe(1)
})
