import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { createServer, normalizePath } from '../..'

function createRoot() {
  return fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vite-restart-deps-cache-'),
  )
}

function writePackage(root: string, name: string, code: string) {
  const depDir = path.join(root, 'node_modules', name)
  fs.mkdirSync(depDir, { recursive: true })
  fs.writeFileSync(
    path.join(depDir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      type: 'module',
      main: 'index.js',
    }),
  )
  fs.writeFileSync(path.join(depDir, 'index.js'), code)
}

test('keeps the warm stable cache when restart setup transforms a dependency', async (ctx) => {
  const root = createRoot()
  ctx.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }))

  const cacheDir = path.join(root, '.vite-shared')
  writePackage(root, 'dep', 'export const marker = "restart-prelisten"\n')
  fs.writeFileSync(path.join(root, 'entry.js'), 'import "dep"\n')

  let configureCalls = 0
  let optimizerBuilds = 0
  const server = await createServer({
    configFile: false,
    root,
    cacheDir,
    logLevel: 'silent',
    optimizeDeps: {
      include: ['dep'],
      entries: ['entry.js'],
      rolldownOptions: {
        plugins: [
          {
            name: 'test:count-restart-prelisten-optimizer-builds',
            generateBundle() {
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
  ctx.onTestFinished(() => server.close())

  await vi.waitFor(
    () =>
      expect(
        server.environments.client.depsOptimizer!.metadata.optimized.dep,
      ).toBeTruthy(),
    { timeout: 5000 },
  )

  const before = server.environments.client.depsOptimizer!.metadata.optimized.dep
  const buildsBeforeRestart = optimizerBuilds
  expect(buildsBeforeRestart).toBeGreaterThan(0)
  expect(normalizePath(before.file)).toBe(
    normalizePath(path.join(cacheDir, 'deps', 'dep.js')),
  )

  await server.restart()

  await vi.waitFor(
    () =>
      expect(
        server.environments.client.depsOptimizer!.metadata.optimized.dep,
      ).toBeTruthy(),
    { timeout: 5000 },
  )

  expect(configureCalls).toBe(2)
  const after = server.environments.client.depsOptimizer!.metadata.optimized.dep
  expect(after.file).toBe(before.file)
  expect(after.file).not.toContain('_deps_session_')
  expect(optimizerBuilds).toBe(buildsBeforeRestart)
})

test('keeps a private warm cache across restart while the stable owner stays live', async (ctx) => {
  const root = createRoot()
  ctx.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }))

  const cacheDir = path.join(root, '.vite-shared')
  writePackage(root, 'stable-dep', 'export const marker = "stable"\n')
  writePackage(root, 'private-dep', 'export const marker = "private"\n')
  fs.writeFileSync(path.join(root, 'entry-private.js'), 'import "private-dep"\n')

  const stableServer = await createServer({
    configFile: false,
    root,
    cacheDir,
    logLevel: 'silent',
    optimizeDeps: {
      noDiscovery: true,
      include: ['stable-dep'],
    },
    server: {
      middlewareMode: true,
      ws: false,
    },
  })
  ctx.onTestFinished(() => stableServer.close())
  const stableInfo =
    stableServer.environments.client.depsOptimizer!.metadata.optimized[
      'stable-dep'
    ]
  expect(normalizePath(stableInfo.file)).toBe(
    normalizePath(path.join(cacheDir, 'deps', 'stable-dep.js')),
  )

  let configureCalls = 0
  let optimizerBuilds = 0
  const privateServer = await createServer({
    configFile: false,
    root,
    cacheDir,
    logLevel: 'silent',
    optimizeDeps: {
      include: ['private-dep'],
      entries: ['entry-private.js'],
      rolldownOptions: {
        plugins: [
          {
            name: 'test:count-private-restart-optimizer-builds',
            generateBundle() {
              optimizerBuilds++
            },
          },
        ],
      },
    },
    plugins: [
      {
        name: 'test:transform-private-during-restart-configure',
        async configureServer(candidate) {
          if (configureCalls++ === 0) return
          await candidate.environments.client.transformRequest('/entry-private.js')
        },
      },
    ],
    server: {
      middlewareMode: true,
      ws: false,
    },
  })
  ctx.onTestFinished(() => privateServer.close())

  await vi.waitFor(
    () =>
      expect(
        privateServer.environments.client.depsOptimizer!.metadata.optimized[
          'private-dep'
        ],
      ).toBeTruthy(),
    { timeout: 5000 },
  )

  const before =
    privateServer.environments.client.depsOptimizer!.metadata.optimized[
      'private-dep'
    ]
  const buildsBeforeRestart = optimizerBuilds
  expect(buildsBeforeRestart).toBeGreaterThan(0)
  expect(before.file).toContain('_deps_session_')
  expect(fs.existsSync(stableInfo.file)).toBe(true)

  await privateServer.restart()

  await vi.waitFor(
    () =>
      expect(
        privateServer.environments.client.depsOptimizer!.metadata.optimized[
          'private-dep'
        ],
      ).toBeTruthy(),
    { timeout: 5000 },
  )

  expect(configureCalls).toBe(2)
  const after =
    privateServer.environments.client.depsOptimizer!.metadata.optimized[
      'private-dep'
    ]
  expect(after.file).toBe(before.file)
  expect(after.file).toContain('_deps_session_')
  expect(optimizerBuilds).toBe(buildsBeforeRestart)
  expect(fs.existsSync(stableInfo.file)).toBe(true)
})
