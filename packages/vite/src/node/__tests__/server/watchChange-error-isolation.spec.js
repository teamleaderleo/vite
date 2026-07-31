import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { promiseWithResolvers } from '../../../shared/utils'
import { createLogger } from '../../logger'
import { createServer } from '../../server'

test('watchChange errors do not prevent invalidation or HMR', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-watch-change-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const stateFile = path.join(root, 'state.txt')
  const virtualId = '\0virtual:watch-change-state'
  const virtualRequestId = 'virtual:watch-change-state'
  const watchChangeError = new Error('watchChange rejection')

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': [
      "import { value } from 'virtual:watch-change-state'",
      'console.log(value)',
      "if (import.meta.hot) import.meta.hot.accept('virtual:watch-change-state', () => {})",
    ].join('\n'),
    'state.txt': 'alpha\n',
  })

  const loggedError = promiseWithResolvers()
  const hotUpdateCalled = promiseWithResolvers()
  const loggedErrors = []
  const logger = createLogger('silent')
  logger.error = (error) => {
    loggedErrors.push(error)
    loggedError.resolve()
  }

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    customLogger: logger,
    plugins: [
      {
        name: 'watch-change-state',
        resolveId(id) {
          if (id === virtualRequestId) return virtualId
        },
        async load(id) {
          if (id !== virtualId) return
          this.addWatchFile(stateFile)
          const value = (await readFile(stateFile, 'utf8')).trim()
          return `export const value = ${JSON.stringify(value)}`
        },
        watchChange(id) {
          if (path.resolve(id) === stateFile) throw watchChangeError
        },
        hotUpdate({ file }) {
          if (path.resolve(file) === stateFile) {
            hotUpdateCalled.resolve()
            return []
          }
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await server.transformRequest('/src/main.js')
  const first = await server.transformRequest(virtualRequestId)
  expect(first?.code).toContain('alpha')

  const mod = server.environments.client.moduleGraph.getModuleById(virtualId)
  expect(mod?.transformResult).toBeTruthy()

  await writeFile(stateFile, 'beta\n')
  server.watcher.emit('change', stateFile)

  await withTimeout(loggedError.promise, 'watchChange error was not logged')
  await withTimeout(hotUpdateCalled.promise, 'hotUpdate hook was not reached')
  await waitUntil(
    () => mod.transformResult == null,
    'module was not invalidated',
  )

  expect(loggedErrors).toContain(watchChangeError)
  const refreshed = await server.transformRequest(virtualRequestId)
  expect(refreshed?.code).toContain('beta')
})

async function writeProject(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = path.join(root, relativePath)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content)
  }
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

async function withTimeout(promise, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 2_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
