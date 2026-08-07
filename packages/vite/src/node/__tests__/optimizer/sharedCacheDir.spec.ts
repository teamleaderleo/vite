import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { ViteDevServer } from '../..'
import { createServer } from '../..'

const servers = new Set<ViteDevServer>()
let root: string | undefined

afterEach(async () => {
  await Promise.allSettled([...servers].map((server) => server.close()))
  servers.clear()
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

async function createOptimizedServer(
  cacheDir: string,
  dep: string,
): Promise<ViteDevServer> {
  const server = await createServer({
    configFile: false,
    root,
    cacheDir,
    logLevel: 'silent',
    resolve: {
      alias: {
        dep,
      },
    },
    optimizeDeps: {
      force: true,
      noDiscovery: true,
      include: ['dep'],
    },
    server: {
      ws: false,
    },
  })
  servers.add(server)
  await server.environments.client.depsOptimizer!.init()
  return server
}

test('isolates dependency caches for overlapping dev servers', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-shared-deps-cache-'))
  const cacheDir = path.join(root, '.vite-shared')
  const depA = path.join(root, 'dep-a.js')
  const depB = path.join(root, 'dep-b.js')
  fs.writeFileSync(depA, 'export const marker = "from-a"\n')
  fs.writeFileSync(depB, 'export const marker = "from-b"\n')

  const serverA = await createOptimizedServer(cacheDir, depA)
  const environmentA = serverA.environments.client
  const infoA = environmentA.depsOptimizer!.metadata.optimized.dep

  expect(fs.readFileSync(infoA.file, 'utf8')).toContain('from-a')

  const serverB = await createOptimizedServer(cacheDir, depB)
  const environmentB = serverB.environments.client
  const infoB = environmentB.depsOptimizer!.metadata.optimized.dep

  expect(path.resolve(serverA.config.cacheDir)).toBe(path.resolve(cacheDir))
  expect(path.resolve(serverB.config.cacheDir)).toBe(path.resolve(cacheDir))
  expect(path.resolve(environmentA.config.cacheDir)).toBe(path.resolve(cacheDir))
  expect(path.resolve(environmentB.config.cacheDir)).not.toBe(
    path.resolve(cacheDir),
  )
  expect(infoA.file).not.toBe(infoB.file)
  expect(fs.readFileSync(infoA.file, 'utf8')).toContain('from-a')
  expect(fs.readFileSync(infoB.file, 'utf8')).toContain('from-b')

  const loadedByA = await environmentA.pluginContainer.load(
    `${infoA.file}?v=${infoA.browserHash}`,
  )
  expect(typeof loadedByA === 'string' ? loadedByA : loadedByA?.code).toContain(
    'from-a',
  )

  const isolatedCacheDir = environmentB.config.cacheDir
  await serverB.close()
  servers.delete(serverB)
  expect(fs.existsSync(isolatedCacheDir)).toBe(false)

  await serverA.close()
  servers.delete(serverA)

  const serverC = await createOptimizedServer(cacheDir, depA)
  expect(path.resolve(serverC.environments.client.config.cacheDir)).toBe(
    path.resolve(cacheDir),
  )
})
