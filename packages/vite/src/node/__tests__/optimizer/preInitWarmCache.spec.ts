import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test, vi } from 'vitest'
import { createServer } from '../..'

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

test('settles a pre-init optimized dep request when adopting a warm cache', async () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vite-preinit-warm-cache-'),
  )
  const cacheDir = path.join(root, '.vite')
  writePackage(root, 'dep', 'export const marker = "warm-cache"\n')
  fs.writeFileSync(path.join(root, 'entry.js'), 'import "dep"\n')

  let configureCalls = 0
  const server = await createServer({
    configFile: false,
    root,
    cacheDir,
    logLevel: 'silent',
    optimizeDeps: {
      include: ['dep'],
      entries: ['entry.js'],
    },
    plugins: [
      {
        name: 'test:preinit-warm-cache',
        async configureServer(candidate) {
          if (configureCalls++ === 0) return

          // This runs while the replacement server is still being created,
          // before its dependency optimizer has finished init().
          await candidate.environments.client.transformRequest('/entry.js')
        },
      },
    ],
    server: {
      middlewareMode: true,
      ws: false,
      watch: null,
    },
  })

  try {
    await vi.waitFor(
      () =>
        expect(
          server.environments.client.depsOptimizer!.metadata.optimized.dep,
        ).toBeTruthy(),
      { timeout: 5000 },
    )

    await server.restart()

    const closePromise = server.close()
    const closedPromptly = await Promise.race([
      closePromise.then(() => true),
      delay(100, false),
    ])

    try {
      expect(closedPromptly).toBe(true)
    } finally {
      if (!closedPromptly) {
        // Baseline cleanup: closing marks the optimizer closed, so one queued
        // run settles the orphaned pre-init processing promise and lets the
        // in-flight optimized-dep load finish.
        server.environments.client.depsOptimizer?.run()
      }
      await closePromise
    }

    expect(configureCalls).toBe(2)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('optimizes a new dependency discovered before warm-cache init', async () => {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vite-preinit-new-dep-'),
  )
  const cacheDir = path.join(root, '.vite')
  const entry = path.join(root, 'entry.js')

  writePackage(root, 'cached-dep', 'export const marker = "cached"\n')
  writePackage(root, 'new-dep', 'export const marker = "new"\n')
  fs.writeFileSync(entry, 'import "cached-dep"\n')

  let configureCalls = 0
  const server = await createServer({
    configFile: false,
    root,
    cacheDir,
    logLevel: 'silent',
    optimizeDeps: {
      entries: 'entry.js',
    },
    plugins: [
      {
        name: 'test:preinit-new-dep',
        async configureServer(candidate) {
          if (configureCalls++ === 0) return
          await candidate.environments.client.transformRequest('/entry.js')
        },
      },
    ],
    server: {
      middlewareMode: true,
      ws: false,
      watch: null,
    },
  })

  try {
    await vi.waitFor(
      () =>
        expect(
          server.environments.client.depsOptimizer!.metadata.optimized[
            'cached-dep'
          ],
        ).toBeTruthy(),
      { timeout: 5000 },
    )

    // The replacement server will see this import during configureServer,
    // before its dependency optimizer has finished init().
    fs.writeFileSync(entry, 'import "new-dep"\n')

    await server.restart()

    await vi.waitFor(
      () =>
        expect(
          server.environments.client.depsOptimizer!.metadata.optimized[
            'new-dep'
          ],
        ).toBeTruthy(),
      { timeout: 5000 },
    )

    expect(configureCalls).toBe(2)

    const closePromise = server.close()
    const closedPromptly = await Promise.race([
      closePromise.then(() => true),
      delay(100, false),
    ])

    expect(closedPromptly).toBe(true)
    await closePromise
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
