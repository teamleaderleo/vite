import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { createServer, normalizePath } from '../..'

test('keeps warm cache ownership when replacement transforms during configureServer', async (ctx) => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vite-restart-deps-cache-'),
  )
  ctx.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }))

  const cacheDir = path.join(root, '.vite-shared')
  const depDir = path.join(root, 'node_modules', 'dep')
  fs.mkdirSync(depDir, { recursive: true })
  fs.writeFileSync(
    path.join(depDir, 'package.json'),
    JSON.stringify({
      name: 'dep',
      version: '1.0.0',
      type: 'module',
      main: 'index.js',
    }),
  )
  fs.writeFileSync(path.join(depDir, 'index.js'), 'export const marker = "dep"\n')
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
            name: 'test:count-restart-optimizer-builds',
            generateBundle() {
              optimizerBuilds++
            },
          },
        ],
      },
    },
    plugins: [
      {
        name: 'test:transform-during-restart-configure',
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

  const after = server.environments.client.depsOptimizer!.metadata.optimized.dep
  expect(after.file).toBe(before.file)
  expect(after.file).not.toContain('_deps_session_')
  expect(optimizerBuilds).toBe(buildsBeforeRestart)
})
