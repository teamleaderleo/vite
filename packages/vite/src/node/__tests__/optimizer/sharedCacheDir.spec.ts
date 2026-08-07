import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { ViteDevServer } from '../..'
import { createServer } from '../..'

let root: string | undefined
let servers: ViteDevServer[] = []

afterEach(async () => {
  await Promise.allSettled(servers.map((server) => server.close()))
  servers = []
  if (root) {
    await fs.rm(root, { recursive: true, force: true })
    root = undefined
  }
})

test('keeps optimized deps isolated between dev servers sharing cacheDir', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-shared-deps-'))

  const depA = path.join(root, 'dep-a.js')
  const depB = path.join(root, 'dep-b.js')
  await Promise.all([
    fs.writeFile(depA, `export const source = 'from-a'\n`),
    fs.writeFile(depB, `export const source = 'from-b'\n`),
  ])

  const cacheDir = path.join(root, '.vite-shared')

  const createOptimizedServer = async (replacement: string) => {
    const server = await createServer({
      configFile: false,
      root,
      cacheDir,
      logLevel: 'silent',
      resolve: {
        alias: {
          dep: replacement,
        },
      },
      optimizeDeps: {
        include: ['dep'],
        noDiscovery: true,
        force: true,
      },
    })
    servers.push(server)

    const optimizer = server.environments.client.depsOptimizer!
    await optimizer.init()
    return {
      server,
      info: optimizer.metadata.optimized.dep,
    }
  }

  const a = await createOptimizedServer(depA)
  expect(a.info).toBeDefined()
  expect(await fs.readFile(a.info.file, 'utf-8')).toContain('from-a')

  const b = await createOptimizedServer(depB)
  expect(b.info).toBeDefined()
  expect(a.info.browserHash).not.toBe(b.info.browserHash)

  expect(await fs.readFile(a.info.file, 'utf-8')).toContain('from-a')
  expect(await fs.readFile(b.info.file, 'utf-8')).toContain('from-b')
})
