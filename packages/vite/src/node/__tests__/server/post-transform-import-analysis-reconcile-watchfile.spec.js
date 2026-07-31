import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
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

test('keeps a late dynamic import out of static import state', async () => {
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
  expect(main.staticImportedUrls?.has(dep.url)).toBe(false)
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
