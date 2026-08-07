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
  const optimizerA = environmentA.depsOptimizer!
  const infoA = optimizerA.metadata.optimized.dep

  expect(fs.readFileSync(infoA.file, 'utf8')).toContain('from-a')

  const serverB = await createOptimizedServer(cacheDir, depB)
  const environmentB = serverB.environments.client
  const optimizerB = environmentB.depsOptimizer!
  const infoB = optimizerB.metadata.optimized.dep

  expect(path.resolve(serverA.config.cacheDir)).toBe(path.resolve(cacheDir))
  expect(path.resolve(serverB.config.cacheDir)).toBe(path.resolve(cacheDir))
  expect(infoA.file).not.toBe(infoB.file)
  expect(fs.readFileSync(infoA.file, 'utf8')).toContain('from-a')
  expect(fs.readFileSync(infoB.file, 'utf8')).toContain('from-b')

  const urlA = `/${path.relative(root, infoA.file).split(path.sep).join('/')}`
  const urlB = `/${path.relative(root, infoB.file).split(path.sep).join('/')}`
  expect(optimizerA.isOptimizedDepFile(infoA.file)).toBe(true)
  expect(optimizerA.isOptimizedDepUrl(urlA)).toBe(true)
  expect(optimizerA.isOptimizedDepFile(infoB.file)).toBe(false)
  expect(optimizerA.isOptimizedDepUrl(urlB)).toBe(false)

  const loadedByA = await environmentA.pluginContainer.load(
    `${infoA.file}?v=${infoA.browserHash}`,
  )
  expect(typeof loadedByA === 'string' ? loadedByA : loadedByA?.code).toContain(
    'from-a',
  )

  await serverB.close()
  servers.delete(serverB)
  expect(fs.existsSync(infoB.file)).toBe(false)

  await serverA.close()
  servers.delete(serverA)

  const serverC = await createOptimizedServer(cacheDir, depA)
  const infoC = serverC.environments.client.depsOptimizer!.metadata.optimized.dep
  expect(infoC.file).toBe(infoA.file)
})
