import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { optimizeDeps, resolveConfig } from '../..'

test('closes the standalone optimizeDeps scan plugin container', async (ctx) => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vite-standalone-optimize-close-'),
  )
  ctx.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }))

  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<script type="module" src="/entry.js"></script>\n',
  )
  fs.writeFileSync(path.join(root, 'entry.js'), 'export const marker = true\n')

  let optionsCalls = 0
  let closeBundleCalls = 0
  const config = await resolveConfig(
    {
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [
        {
          name: 'test:standalone-optimize-container-lifecycle',
          options() {
            optionsCalls++
          },
          closeBundle() {
            closeBundleCalls++
          },
        },
      ],
      optimizeDeps: {
        force: true,
      },
    },
    'serve',
  )

  await optimizeDeps(config, true)

  expect(optionsCalls).toBeGreaterThan(0)
  expect(closeBundleCalls).toBe(1)
})
