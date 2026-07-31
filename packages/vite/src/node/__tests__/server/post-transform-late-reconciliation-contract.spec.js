import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test, vi } from 'vitest'
import { createServer } from '../../server'
import { updateModules } from '../../server/hmr'
import {
  lateImportAnalysisPlugin,
  lateImportOverlayPreservePlugins,
} from '../../plugins/lateImportAnalysis'

test('late reconciliation preserves raw imports and records final graph state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-late-reconcile-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': [
      "globalThis.loadRaw = () => __raw_import__('./raw.txt')",
      "console.log('main')",
    ].join('\n'),
    'src/dep.js': "export const dep = 'late dependency'",
    'src/raw.txt': 'raw dependency',
  })

  let includeLateState = true
  let mainTransformCount = 0
  let sawPreviousAcceptedDependencyDuringPost
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      ...lateImportOverlayPreservePlugins(),
      {
        name: 'inject-final-source-state',
        transform: {
          order: 'post',
          handler(code, id) {
            if (!normalizePath(id).endsWith('/src/main.js')) return
            mainTransformCount++
            if (mainTransformCount > 1) {
              const current = this.environment.moduleGraph.getModuleById(id)
              sawPreviousAcceptedDependencyDuringPost = [
                ...(current?.acceptedHmrDeps ?? []),
              ].some((dependency) => dependency.url.endsWith('/src/dep.js'))
            }

            const rawImportCode = code.replace('__raw_import__', 'import')
            if (!includeLateState) return rawImportCode
            return [
              rawImportCode,
              "import { dep } from './dep.js'",
              'console.log(dep)',
              "if (import.meta.hot) import.meta.hot.accept('./dep.js', () => {})",
            ].join('\n')
          },
        },
      },
      lateImportAnalysisPlugin(),
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  const transformed = await server.transformRequest('/src/main.js')

  expect(transformed?.code).toContain("import('./raw.txt')")
  expect(transformed?.code).not.toContain('raw.txt?import')
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

  payloads.length = 0
  environment.moduleGraph.invalidateModule(main)
  await server.transformRequest('/src/main.js')

  includeLateState = false
  payloads.length = 0
  environment.moduleGraph.invalidateModule(main)
  await server.transformRequest('/src/main.js')
  const prunes = payloads.filter((payload) => payload.type === 'prune')

  expect(sawPreviousAcceptedDependencyDuringPost).toBe(true)
  expect(prunes).toHaveLength(1)
  expect(prunes[0].paths).toContain(dep.url)
  expect(main.importedModules.has(dep)).toBe(false)
  expect(main.acceptedHmrDeps.has(dep)).toBe(false)
})

test('restores previous late self-acceptance before the next post transform', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-late-self-accept-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
  })

  let transformCount = 0
  let sawPreviousSelfAcceptingDuringPost
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      ...lateImportOverlayPreservePlugins(),
      {
        name: 'inject-late-self-accept',
        transform: {
          order: 'post',
          handler(code, id) {
            if (!normalizePath(id).endsWith('/src/main.js')) return
            transformCount++
            if (transformCount > 1) {
              sawPreviousSelfAcceptingDuringPost =
                this.environment.moduleGraph.getModuleById(id)?.isSelfAccepting
            }
            return `${code}\nif (import.meta.hot) import.meta.hot.accept()`
          },
        },
      },
      lateImportAnalysisPlugin(),
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await server.transformRequest('/src/main.js')
  const environment = server.environments.client
  const main = await environment.moduleGraph.getModuleByUrl('/src/main.js')
  expect(main.isSelfAccepting).toBe(true)

  environment.moduleGraph.invalidateModule(main)
  await server.transformRequest('/src/main.js')
  expect(sawPreviousSelfAcceptingDuringPost).toBe(true)
})

test('records exports accepted by a late post transform', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-late-exports-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
  })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      ...lateImportOverlayPreservePlugins(),
      {
        name: 'inject-late-accepted-export',
        transform: {
          order: 'post',
          handler(code, id) {
            if (!normalizePath(id).endsWith('/src/main.js')) return
            return [
              code,
              'export const lateValue = 1',
              "if (import.meta.hot) import.meta.hot.acceptExports(['lateValue'])",
            ].join('\n')
          },
        },
      },
      lateImportAnalysisPlugin(),
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await server.transformRequest('/src/main.js')
  const main = await server.environments.client.moduleGraph.getModuleByUrl(
    '/src/main.js',
  )
  expect(main.acceptedHmrExports?.has('lateValue')).toBe(true)
})

test('records bindings introduced by a late static import', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-late-bindings-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
    'src/dep.js': 'export const dep = 1',
  })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    experimental: { hmrPartialAccept: true },
    plugins: [
      ...lateImportOverlayPreservePlugins(),
      {
        name: 'inject-late-named-import',
        transform: {
          order: 'post',
          handler(code, id) {
            if (!normalizePath(id).endsWith('/src/main.js')) return
            return `${code}\nimport { dep } from './dep.js'\nconsole.log(dep)`
          },
        },
      },
      lateImportAnalysisPlugin(),
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await server.transformRequest('/src/main.js')
  const main = await server.environments.client.moduleGraph.getModuleByUrl(
    '/src/main.js',
  )
  expect(
    [...(main.importedBindings?.values() ?? [])].some((bindings) =>
      bindings.has('dep'),
    ),
  ).toBe(true)
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
