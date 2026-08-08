import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { ViteDevServer } from '../..'
import { createServer, normalizePath } from '../..'

let server: ViteDevServer | undefined
let root: string | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

function writePackage(name: string, code: string) {
  const dir = path.join(root!, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.js' }),
  )
  fs.writeFileSync(path.join(dir, 'index.js'), code)
}

test('keeps the warm stable cache when restart setup transforms a dependency', async () => {
  root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vite-restart-prelisten-deps-'),
  )
  const cacheDir = path.join(root, '.vite-shared')
  writePackage('dep', 'export const marker = "restart-prelisten"\n')
  fs.writeFileSync(path.join(root, 'entry.js'), 'import "dep"\n')

  let configureCalls = 0
  let optimizerBuilds = 0

  server = await createServer({
    configFile: false,
    root,
    cacheDir,
    logLevel: 'silent',
    optimizeDeps: {
      noDiscovery: false,
      include: ['dep'],
      holdUntilCrawlEnd: false,
      rolldownOptions: {
        plugins: [
          {
            name: 'test:count-restart-prelisten-optimizer-builds',
            buildStart() {
              optimizerBuilds++
            },
          },
        ],
      },
    },
    plugins: [
      {
        name: 'test:restart-prelisten-transform',
        async configureServer(candidate) {
          if (configureCalls++ === 0) return
          await candidate.environments.client.transformRequest('/entry.js')
        },
      },
    ],
    server: {
      middlewareMode: true,
      ws: false,
    },
  })

  const beforeOptimizer = server.environments.client.depsOptimizer!
  await beforeOptimizer.init()
  await vi.waitFor(
    () => expect(beforeOptimizer.metadata.optimized.dep).toBeTruthy(),
    { timeout: 5000 },
  )
  expect(optimizerBuilds).toBe(1)

  const before = beforeOptimizer.metadata.optimized.dep
  expect(normalizePath(before.file)).toBe(
    normalizePath(path.join(cacheDir, 'deps', 'dep.js')),
  )

  await server.restart()

  expect(configureCalls).toBe(2)
  expect(optimizerBuilds).toBe(1)
  const after = server.environments.client.depsOptimizer!.metadata.optimized.dep
  expect(after.file).toBe(before.file)
  expect(after.file).not.toContain('_deps_session_')
})
