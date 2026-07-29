import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test, vi } from 'vitest'
import { createServer } from '../../server'
import { updateModules } from '../../server/hmr'

test('import analysis runs after user post transforms', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-post-transform-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
    'src/dep.js': "export const dep = 'POST_TRANSFORM_DEP'",
  })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'inject-import-post-transform',
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
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  const transformed = await server.transformRequest('/src/main.js')
  expect(transformed?.code).toContain('dep.js')
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
