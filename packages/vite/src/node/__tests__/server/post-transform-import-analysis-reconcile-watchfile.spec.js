import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test, vi } from 'vitest'
import { createServer } from '../../server'

test('reconciles a watch file added by a source-preserving post transform', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-post-watch-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const watchedFile = path.join(root, 'src', 'watched.txt')
  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
    'src/watched.txt': 'watched dependency',
  })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'late-watch-file',
        transform: {
          order: 'post',
          handler(_code, id) {
            if (normalizePath(id).endsWith('/src/main.js')) {
              this.addWatchFile(watchedFile)
            }
          },
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await server.transformRequest('/src/main.js')

  const main = await server.environments.client.moduleGraph.getModuleByUrl(
    '/src/main.js',
  )
  expect(main).toBeTruthy()
  expect(
    [...main.importedModules].some(
      (dependency) => dependency.file === normalizePath(watchedFile),
    ),
  ).toBe(true)
})

test('does not confuse source text with a previously analyzed import', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-post-collision-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': `console.log("import 'picocolors'")`,
  })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'late-bare-import-with-text-collision',
        transform: {
          order: 'post',
          handler(code, id) {
            if (normalizePath(id).endsWith('/src/main.js')) {
              return `${code}\nimport 'picocolors'`
            }
          },
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await expect(server.transformRequest('/src/main.js')).rejects.toThrow(
    'still requires Vite URL rewriting',
  )
})

test('does not confuse source text with analyzed import.meta.env usage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-post-env-collision-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': `console.log('import.meta.env')`,
  })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'late-env-with-text-collision',
        transform: {
          order: 'post',
          handler(code, id) {
            if (normalizePath(id).endsWith('/src/main.js')) {
              return `${code}\nglobalThis.mode = import.meta.env.MODE`
            }
          },
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await expect(server.transformRequest('/src/main.js')).rejects.toThrow(
    'introduced import.meta.env after normal import analysis',
  )
})

test('keeps an analyzable late dynamic import in timestamp invalidation state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-post-dynamic-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "globalThis.load = () => __raw_import__('./dep.js')",
    'src/dep.js': "export const value = 'dynamic'",
  })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'late-dynamic-import',
        transform: {
          order: 'post',
          handler(code, id) {
            if (normalizePath(id).endsWith('/src/main.js')) {
              return code.replace('__raw_import__', 'import')
            }
          },
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await server.transformRequest('/src/main.js')
  await server.transformRequest('/src/dep.js')

  const environment = server.environments.client
  const main = await environment.moduleGraph.getModuleByUrl('/src/main.js')
  const dep = await environment.moduleGraph.getModuleByUrl('/src/dep.js')

  expect(main).toBeTruthy()
  expect(dep).toBeTruthy()
  expect(main.importedModules.has(dep)).toBe(true)
  expect(main.staticImportedUrls?.has(dep.url)).toBe(true)
})

test('does not publish graph state from a superseded transform request', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-post-stale-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
    'src/dep-initial.js': "export const value = 'initial'",
    'src/dep-stale.js': "export const value = 'stale'",
    'src/dep-fresh.js': "export const value = 'fresh'",
  })

  let mode = 'initial'
  let signalStaleEntered = () => {}
  let releaseStaleTransform = () => {}
  const staleEntered = new Promise((resolve) => {
    signalStaleEntered = resolve
  })
  const staleReleased = new Promise((resolve) => {
    releaseStaleTransform = resolve
  })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'select-late-import-with-stale-request',
        transform: {
          order: 'post',
          async handler(code, id) {
            if (!normalizePath(id).endsWith('/src/main.js')) return
            const requestMode = mode
            if (requestMode === 'stale') {
              signalStaleEntered()
              await staleReleased
            }
            return `${code}\nimport './dep-${requestMode}.js'`
          },
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await server.transformRequest('/src/main.js')
  const environment = server.environments.client
  const main = await environment.moduleGraph.getModuleByUrl('/src/main.js')

  mode = 'stale'
  environment.moduleGraph.invalidateModule(main)
  const staleRequest = server.transformRequest('/src/main.js')
  await staleEntered

  mode = 'fresh'
  environment.moduleGraph.invalidateModule(main)
  await server.transformRequest('/src/main.js')

  releaseStaleTransform()
  await staleRequest

  const initial = await environment.moduleGraph.getModuleByUrl(
    '/src/dep-initial.js',
  )
  const stale = await environment.moduleGraph.getModuleByUrl('/src/dep-stale.js')
  const fresh = await environment.moduleGraph.getModuleByUrl('/src/dep-fresh.js')

  expect(main.importedModules.has(fresh)).toBe(true)
  expect(main.importedModules.has(stale)).toBe(false)
  expect(main.importedModules.has(initial)).toBe(false)
})

test('preserves the previous committed graph when final parsing fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-post-rollback-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
    'src/dep.js': 'export const dep = 1',
  })

  let validFinalSource = true
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'inject-valid-or-invalid-final-source',
        transform: {
          order: 'post',
          handler(code, id) {
            if (!normalizePath(id).endsWith('/src/main.js')) return
            return validFinalSource ? `${code}\nimport './dep.js'` : `${code}\nimport {`
          },
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await server.transformRequest('/src/main.js')
  const environment = server.environments.client
  const main = await environment.moduleGraph.getModuleByUrl('/src/main.js')
  const dep = await environment.moduleGraph.getModuleByUrl('/src/dep.js')
  expect(main.importedModules.has(dep)).toBe(true)

  const payloads = []
  vi.spyOn(environment.hot, 'send').mockImplementation((payload) => {
    payloads.push(payload)
  })

  validFinalSource = false
  environment.moduleGraph.invalidateModule(main)
  await expect(server.transformRequest('/src/main.js')).rejects.toThrow()

  expect(main.importedModules.has(dep)).toBe(true)
  expect(payloads.filter((payload) => payload.type === 'prune')).toEqual([])
})

async function writeProject(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = path.join(root, relativePath)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content)
  }
}

function normalizePath(filename) {
  return filename.split(path.sep).join('/')
}
