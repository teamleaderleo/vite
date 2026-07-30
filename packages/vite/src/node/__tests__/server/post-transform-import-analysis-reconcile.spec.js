import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test, vi } from 'vitest'
import { createServer } from '../../server'
import { updateModules } from '../../server/hmr'

test('preserves the current post-transform input stage', async () => {
  const root = await createProject({
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': [
      "import { dep } from './dep.js'",
      'console.log(dep)',
      "if (import.meta.hot) import.meta.hot.accept('./dep.js', () => {})",
    ].join('\n'),
    'src/dep.js': "export const dep = 'dep'",
  })

  let postTransformInput
  const server = await createTestServer(root, [
    {
      name: 'record-post-transform-input',
      transform: {
        order: 'post',
        handler(code, id) {
          if (normalizePath(id).endsWith('/src/main.js')) {
            postTransformInput = code
          }
        },
      },
    },
  ])

  await server.transformRequest('/src/main.js')

  expect(postTransformInput).toContain('__vite__createHotContext')
  expect(postTransformInput).toContain(
    'import.meta.hot.accept("/src/dep.js"',
  )
})

test('reconciles a late relative import and HMR boundary without rewriting the import', async () => {
  const root = await createProject({
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
    'src/dep.js': "export const dep = 'LATE_DEP'",
  })

  const server = await createTestServer(root, [
    {
      name: 'inject-late-import-and-hmr',
      transform: {
        order: 'post',
        handler(code, id) {
          if (!normalizePath(id).endsWith('/src/main.js')) return
          return [
            code,
            "import { dep } from './dep.js'",
            'console.log(dep)',
            "if (import.meta.hot) import.meta.hot.accept('./dep.js', () => {})",
          ].join('\n')
        },
      },
    },
  ])

  const transformed = await server.transformRequest('/src/main.js')
  expect(transformed?.code).toContain("from './dep.js'")
  expect(transformed?.code).toContain('__vite__createHotContext')

  await server.transformRequest('/src/dep.js')
  const environment = server.environments.client
  const main = await environment.moduleGraph.getModuleByUrl('/src/main.js')
  const dep = await environment.moduleGraph.getModuleByUrl('/src/dep.js')

  expect(main).toBeTruthy()
  expect(dep).toBeTruthy()
  expect(main.importedModules.has(dep)).toBe(true)
  expect(main.acceptedHmrDeps.has(dep)).toBe(true)

  const payloads = []
  vi.spyOn(environment.hot, 'send').mockImplementation((payload) => {
    payloads.push(payload)
  })
  updateModules(environment, 'src/dep.js', [dep], Date.now())
  expect(payloads).toHaveLength(1)
  expect(payloads[0].type).toBe('update')
})

test('tracks a late raw dynamic import without adding an import query', async () => {
  const root = await createProject({
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "globalThis.load = () => __raw_import__('./dep.txt')",
    'src/dep.txt': 'raw dependency',
  })

  const server = await createTestServer(root, [
    {
      name: 'inject-late-raw-dynamic-import',
      transform: {
        order: 'post',
        handler(code, id) {
          if (normalizePath(id).endsWith('/src/main.js')) {
            return code.replace('__raw_import__', 'import')
          }
        },
      },
    },
  ])

  const transformed = await server.transformRequest('/src/main.js')
  expect(transformed?.code).toContain("import('./dep.txt')")
  expect(transformed?.code).not.toContain('dep.txt?import')

  const main = await server.environments.client.moduleGraph.getModuleByUrl(
    '/src/main.js',
  )
  expect(
    [...main.importedModules].some((module) => module.url.endsWith('/dep.txt')),
  ).toBe(true)
})

test('replaces a previous late graph edge when the post transform changes', async () => {
  const root = await createProject({
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
    'src/dep-a.js': "export const dep = 'A'",
    'src/dep-b.js': "export const dep = 'B'",
  })

  let selected = 'a'
  const server = await createTestServer(root, [
    {
      name: 'select-late-import',
      transform: {
        order: 'post',
        handler(code, id) {
          if (!normalizePath(id).endsWith('/src/main.js')) return
          return `${code}\nimport './dep-${selected}.js'`
        },
      },
    },
  ])

  await server.transformRequest('/src/main.js')
  const environment = server.environments.client
  const main = await environment.moduleGraph.getModuleByUrl('/src/main.js')
  const depA = await environment.moduleGraph.getModuleByUrl('/src/dep-a.js')
  expect(main.importedModules.has(depA)).toBe(true)

  selected = 'b'
  environment.moduleGraph.invalidateModule(main)
  await server.transformRequest('/src/main.js')

  const depB = await environment.moduleGraph.getModuleByUrl('/src/dep-b.js')
  expect(main.importedModules.has(depA)).toBe(false)
  expect(depA.importers.has(main)).toBe(false)
  expect(main.importedModules.has(depB)).toBe(true)
})

test('does not confuse import-like string content with an analyzed import', async () => {
  const root = await createProject({
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': [
      `const marker = "import 'picocolors'"`,
      'console.log(marker)',
    ].join('\n'),
  })

  const server = await createTestServer(root, [
    {
      name: 'inject-late-bare-import',
      transform: {
        order: 'post',
        handler(code, id) {
          if (normalizePath(id).endsWith('/src/main.js')) {
            return `${code}\nimport 'picocolors'`
          }
        },
      },
    },
  ])

  await expect(server.transformRequest('/src/main.js')).rejects.toThrow(
    'still requires Vite URL rewriting',
  )
})

test('does not confuse env-like string content with analyzed import.meta.env', async () => {
  const root = await createProject({
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': [
      'const marker = "import.meta.env"',
      'console.log(marker)',
    ].join('\n'),
  })

  const server = await createTestServer(root, [
    {
      name: 'inject-late-import-meta-env',
      transform: {
        order: 'post',
        handler(code, id) {
          if (normalizePath(id).endsWith('/src/main.js')) {
            return `${code}\nconsole.log(import.meta.env.MODE)`
          }
        },
      },
    },
  ])

  await expect(server.transformRequest('/src/main.js')).rejects.toThrow(
    'introduced import.meta.env after normal import analysis',
  )
})

test('rejects a late static asset import that still requires source rewriting', async () => {
  const root = await createProject({
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
    'src/dep.txt': 'asset dependency',
  })

  const server = await createTestServer(root, [
    {
      name: 'inject-late-static-asset',
      transform: {
        order: 'post',
        handler(code, id) {
          if (normalizePath(id).endsWith('/src/main.js')) {
            return `${code}\nimport './dep.txt'`
          }
        },
      },
    },
  ])

  await expect(server.transformRequest('/src/main.js')).rejects.toThrow(
    'cannot be tracked safely by the late graph-only reconciler',
  )
})

async function createProject(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-post-reconcile-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  await writeProject(root, files)
  return root
}

async function createTestServer(root, plugins) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins,
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())
  return server
}

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
