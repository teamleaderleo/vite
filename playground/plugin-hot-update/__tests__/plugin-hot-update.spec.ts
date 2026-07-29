import { setTimeout } from 'node:timers/promises'
import { expect, onTestFinished, test } from 'vitest'
import {
  addFile,
  editFile,
  isBuild,
  isBundledDev,
  page,
  readFile,
} from '~utils'

test.skipIf(isBuild)(
  'plugin hotUpdate custom state reaches classic dev but not bundled dev',
  async () => {
    const original = readFile('plugin-state.txt')
    onTestFinished(() => addFile('plugin-state.txt', original))

    await expect.poll(() => page.textContent('#state')).toBe('alpha')
    await expect.poll(() => page.textContent('#watch')).toBe('pending')
    await expect.poll(() => page.textContent('#updates')).toBe('0')

    editFile('plugin-state.txt', (content) => content.replace('alpha', 'beta'))

    // watchChange is delivered in both modes, proving that Vite observed the
    // same filesystem event before bundled dev returns from HMR handling.
    await expect.poll(() => page.textContent('#watch')).toBe('seen')

    if (isBundledDev) {
      await setTimeout(500)
      expect(await page.textContent('#state')).toBe('alpha')
      expect(await page.textContent('#updates')).toBe('0')
    } else {
      await expect.poll(() => page.textContent('#state')).toBe('beta')
      await expect.poll(() => page.textContent('#updates')).toBe('1')
    }
  },
)
