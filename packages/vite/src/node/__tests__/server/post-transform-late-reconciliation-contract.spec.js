import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test, vi } from 'vitest'
import { createServer } from '../../server'
import { updateModules } from '../../server/hmr'
import { lateImportAnalysisPlugins } from '../../plugins/lateImportAnalysis'

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
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'inject-final-source-state',
        transform: {
          order: 'post',
          handler(code, id) {
            if (!normalizePath(id).endsWith('/src/main.js')) return
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
      ...lateImportAnalysisPlugins(),
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  const transformed = await server.transformRequest('/src/main.js')

  // Preserve the current first-party escape: imports intentionally introduced
  // after normal import analysis remain raw instead of receiving `?import`.
  expect(transformed?.code).toContain("import('./raw.txt')")
  expect(transformed?.code).not.toContain('raw.txt?import')

  // Reconcile graph and HMR state from the final source without rerunning every
  // URL-rewriting side effect of the normal import-analysis pass.
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

  // Reprocessing a module that still has the same late dependency must not
  // transiently prune the edge during the normal pass and re-add it afterward.
  payloads.length = 0
  environment.moduleGraph.invalidateModule(main)
  await server.transformRequest('/src/main.js')
  expect(payloads.filter((payload) => payload.type === 'prune')).toEqual([])

  // Removing the final-source dependency must replace the retained overlay and
  // emit one real prune instead of keeping the dependency alive indefinitely.
  includeLateState = false
  payloads.length = 0
  environment.moduleGraph.invalidateModule(main)
  await server.transformRequest('/src/main.js')
  const prunes = payloads.filter((payload) => payload.type === 'prune')
  expect(prunes).toHaveLength(1)
  expect(prunes[0].paths).toContain(dep.url)
  expect(main.importedModules.has(dep)).toBe(false)
  expect(main.acceptedHmrDeps.has(dep)).toBe(false)
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
