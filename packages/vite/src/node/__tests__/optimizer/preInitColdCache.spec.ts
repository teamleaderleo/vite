import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { ViteDevServer } from '../..'
import { createServer } from '../..'

let server: ViteDevServer | undefined
let root: string | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

function writePackage(root: string, name: string, code: string) {
  const dir = path.join(root, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      type: 'module',
      main: 'index.js',
    }),
  )
  fs.writeFileSync(path.join(dir, 'index.js'), code)
}

test('keeps a pre-init dependency that is outside the cold-start scan entries', async () => {
  root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vite-preinit-cold-cache-'),
  )
  const cacheDir = path.join(root, '.vite')
  writePackage(root, 'preinit-dep', 'export const marker = "preinit"\n')
  fs.writeFileSync(path.join(root, 'entry.js'), 'import "preinit-dep"\n')
  fs.writeFileSync(
    path.join(root, 'scan-entry.js'),
    'export const marker = "scan"\n',
  )

  server = await createServer({
    configFile: false,
    root,
    cacheDir,
    logLevel: 'silent',
    optimizeDeps: {
      force: true,
      entries: ['scan-entry.js'],
    },
    server: {
      ws: false,
    },
  })

  const environment = server.environments.client
  await environment.transformRequest('/entry.js')

  expect(
    environment.depsOptimizer!.metadata.discovered['preinit-dep'],
  ).toBeTruthy()

  await environment.depsOptimizer!.init()
  await environment.waitForRequestsIdle()
  await environment.depsOptimizer!.scanProcessing

  await vi.waitFor(
    () =>
      expect(
        environment.depsOptimizer!.metadata.optimized['preinit-dep'],
      ).toBeTruthy(),
    { timeout: 3000 },
  )
})
