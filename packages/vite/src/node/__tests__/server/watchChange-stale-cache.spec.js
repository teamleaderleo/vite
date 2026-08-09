import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { createLogger } from '../../logger'
import { createServer } from '../../server'

test('research: watchChange rejection preserves a stale transform cache', async () => {
  const control = await runScenario(false)
  const rejection = await runScenario(true)

  expect(control).toMatchObject({
    invalidatedAfterEvent: true,
    refreshedValue: 'beta',
  })
  expect(rejection).toMatchObject({
    loggedError: true,
    invalidatedAfterEvent: false,
    refreshedValue: 'alpha',
  })
})

async function runScenario(rejectWatchChange) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-watch-change-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const stateFile = path.join(root, 'state.txt')
  const virtualId = '\0virtual:watch-change-state'
  const virtualRequestId = 'virtual:watch-change-state'

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': [
      "import { value } from 'virtual:watch-change-state'",
      'console.log(value)',
      "if (import.meta.hot) import.meta.hot.accept('virtual:watch-change-state', () => {})",
    ].join('\n'),
    'state.txt': 'alpha\n',
  })

  const logger = createLogger('silent')
  let resolveLoggedError
  const loggedError = new Promise((resolve) => {
    resolveLoggedError = resolve
  })
  logger.error = () => resolveLoggedError(true)

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
          if (rejectWatchChange && path.resolve(id) === stateFile) {
            throw new Error('watchChange rejection')
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
  const previousTransform = mod.transformResult

  await writeFile(stateFile, 'beta\n')
  server.watcher.emit('change', stateFile)

  let didLogError = false
  if (rejectWatchChange) {
    didLogError = await withTimeout(
      loggedError,
      2_000,
      'watchChange error was not logged',
    )
  } else {
    await waitUntil(
      () => mod.transformResult == null,
      2_000,
      'module was not invalidated',
    )
  }

  const invalidatedAfterEvent = mod.transformResult == null
  if (rejectWatchChange) {
    expect(mod.transformResult).toBe(previousTransform)
  }

  const refreshed = await server.transformRequest(virtualRequestId)
  const refreshedValue = refreshed?.code.includes('beta') ? 'beta' : 'alpha'

  await server.close()

  return {
    loggedError: didLogError,
    invalidatedAfterEvent,
    refreshedValue,
  }
}

async function writeProject(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = path.join(root, relativePath)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content)
  }
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

async function withTimeout(promise, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
