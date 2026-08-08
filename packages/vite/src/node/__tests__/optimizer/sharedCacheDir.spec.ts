import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { ViteDevServer } from '../..'
import { createServer, normalizePath } from '../..'

const servers = new Set<ViteDevServer>()
let root: string | undefined

afterEach(async () => {
  await Promise.allSettled([...servers].map((server) => server.close()))
  servers.clear()
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

function createRoot() {
  return fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vite-shared-deps-cache-'),
  )
}

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
      middlewareMode: true,
      ws: false,
    },
  })
  servers.add(server)
  await server.environments.client.depsOptimizer!.init()
  return server
}

async function createMultiEnvironmentOptimizedServer(
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
    environments: {
      ssr: {
        optimizeDeps: {
          force: true,
          noDiscovery: true,
          include: ['dep'],
        },
      },
    },
    server: {
      middlewareMode: true,
      ws: false,
    },
  })
  servers.add(server)
  await Promise.all([
    server.environments.client.depsOptimizer!.init(),
    server.environments.ssr.depsOptimizer!.init(),
  ])
  return server
}

function writePackage(name: string, code: string) {
  const dir = path.join(root!, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.js' }),
  )
  fs.writeFileSync(path.join(dir, 'index.js'), code)
  return path.join(dir, 'index.js')
}

test('isolates dependency caches for overlapping dev servers', async () => {
  root = createRoot()
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
  expect(path.resolve(environmentA.config.cacheDir)).toBe(path.resolve(cacheDir))
  expect(path.resolve(environmentB.config.cacheDir)).toBe(path.resolve(cacheDir))
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

test('shares one cache owner prefix across client and ssr environments', async () => {
  root = createRoot()
  const cacheDir = path.join(root, '.vite-shared')
  const depA = path.join(root, 'dep-a.js')
  const depB = path.join(root, 'dep-b.js')
  fs.writeFileSync(depA, 'export const marker = "multi-a"\n')
  fs.writeFileSync(depB, 'export const marker = "multi-b"\n')

  const serverA = await createMultiEnvironmentOptimizedServer(cacheDir, depA)
  const serverB = await createMultiEnvironmentOptimizedServer(cacheDir, depB)

  const clientA = serverA.environments.client.depsOptimizer!
  const ssrA = serverA.environments.ssr.depsOptimizer!
  const clientB = serverB.environments.client.depsOptimizer!
  const ssrB = serverB.environments.ssr.depsOptimizer!

  const clientInfoA = clientA.metadata.optimized.dep
  const ssrInfoA = ssrA.metadata.optimized.dep
  const clientInfoB = clientB.metadata.optimized.dep
  const ssrInfoB = ssrB.metadata.optimized.dep

  const clientDirA = normalizePath(path.dirname(clientInfoA.file))
  const ssrDirA = normalizePath(path.dirname(ssrInfoA.file))
  const clientDirB = normalizePath(path.dirname(clientInfoB.file))
  const ssrDirB = normalizePath(path.dirname(ssrInfoB.file))

  expect(clientDirA).toBe(normalizePath(path.join(cacheDir, 'deps')))
  expect(ssrDirA).toBe(normalizePath(path.join(cacheDir, 'deps_ssr')))
  expect(path.dirname(clientDirB)).toBe(normalizePath(cacheDir))
  expect(path.basename(clientDirB)).toMatch(/^_deps_session_/)
  expect(ssrDirB).toBe(`${clientDirB}_ssr`)

  // Recognition remains broad across environment suffixes for one server,
  // while the whole server is isolated from another live server's prefix.
  expect(clientB.isOptimizedDepFile(ssrInfoB.file)).toBe(true)
  expect(clientA.isOptimizedDepFile(clientInfoB.file)).toBe(false)
  expect(clientA.isOptimizedDepFile(ssrInfoB.file)).toBe(false)

  await serverB.close()
  servers.delete(serverB)
  expect(fs.existsSync(clientInfoB.file)).toBe(false)
  expect(fs.existsSync(ssrInfoB.file)).toBe(false)

  expect(fs.existsSync(clientInfoA.file)).toBe(true)
  expect(fs.existsSync(ssrInfoA.file)).toBe(true)
})

test('reuses the stable dependency cache across a normal restart', async () => {
  root = createRoot()
  const cacheDir = path.join(root, '.vite-shared')
  const dep = path.join(root, 'dep.js')
  fs.writeFileSync(dep, 'export const marker = "restart"\n')

  const server = await createOptimizedServer(cacheDir, dep)
  const before = server.environments.client.depsOptimizer!.metadata.optimized.dep

  await server.restart()

  const after = server.environments.client.depsOptimizer!.metadata.optimized.dep
  expect(after.file).toBe(before.file)
  expect(normalizePath(after.file)).toBe(
    normalizePath(path.join(cacheDir, 'deps', 'dep.js')),
  )
  expect(after.file).not.toContain('_deps_session_')
  expect(path.resolve(server.environments.client.config.cacheDir)).toBe(
    path.resolve(cacheDir),
  )
})

test('keeps a warm dependency cache across a normal restart', async () => {
  root = createRoot()
  const cacheDir = path.join(root, '.vite-shared')
  const dep = path.join(root, 'dep.js')
  fs.writeFileSync(dep, 'export const marker = "warm-restart"\n')

  let optimizerBuilds = 0
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
      noDiscovery: true,
      include: ['dep'],
      rolldownOptions: {
        plugins: [
          {
            name: 'test:count-warm-restart-optimizer-builds',
            buildStart() {
              optimizerBuilds++
            },
          },
        ],
      },
    },
    server: {
      middlewareMode: true,
      ws: false,
    },
  })
  servers.add(server)

  await server.environments.client.depsOptimizer!.init()
  expect(optimizerBuilds).toBe(1)
  const before = server.environments.client.depsOptimizer!.metadata.optimized.dep

  await server.restart()

  expect(optimizerBuilds).toBe(1)
  const after = server.environments.client.depsOptimizer!.metadata.optimized.dep
  expect(after.file).toBe(before.file)
  expect(normalizePath(after.file)).toBe(
    normalizePath(path.join(cacheDir, 'deps', 'dep.js')),
  )
})

test('keeps same-config later discovery isolated between live servers', async () => {
  root = createRoot()
  const cacheDir = path.join(root, '.vite-shared')
  writePackage('common', 'export const common = "shared"\n')
  writePackage(
    'dep',
    'import { common } from "common"\nexport const marker = common\n',
  )
  writePackage(
    'extra',
    'import { common } from "common"\nexport const extra = common\n',
  )
  fs.writeFileSync(path.join(root, 'entry-extra.js'), 'import "extra"\n')

  async function createDiscoveryServer() {
    const server = await createServer({
      configFile: false,
      root,
      cacheDir,
      logLevel: 'silent',
      optimizeDeps: {
        force: true,
        include: ['dep'],
        noDiscovery: false,
      },
      server: { middlewareMode: true, ws: false },
    })
    servers.add(server)
    const optimizer = server.environments.client.depsOptimizer!
    await optimizer.init()
    await vi.waitFor(() => expect(optimizer.metadata.optimized.dep).toBeTruthy())
    return server
  }

  const serverA = await createDiscoveryServer()
  const optimizerA = serverA.environments.client.depsOptimizer!
  const infoA = optimizerA.metadata.optimized.dep
  const codeA = fs.readFileSync(infoA.file, 'utf8')

  const serverB = await createDiscoveryServer()
  const environmentB = serverB.environments.client
  const optimizerB = environmentB.depsOptimizer!

  await environmentB.transformRequest('/entry-extra.js')
  await vi.waitFor(
    () => expect(optimizerB.metadata.optimized.extra).toBeTruthy(),
    { timeout: 5000 },
  )

  expect(fs.readFileSync(infoA.file, 'utf8')).toBe(codeA)
  const loadedByA = await serverA.environments.client.pluginContainer.load(
    `${infoA.file}?v=${infoA.browserHash}`,
  )
  expect(typeof loadedByA === 'string' ? loadedByA : loadedByA?.code).toBe(codeA)
})
