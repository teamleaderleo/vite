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

test.each([
  ['add', 'create'],
  ['unlink', 'delete'],
])(
  "watchChange errors do not prevent '%s' hot updates",
  async (watcherEvent, expectedType) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vite-watch-change-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))

    const stateFile = path.join(root, 'state.txt')
    const watchChangeError = new Error('watchChange rejection')
    const loggedError = promiseWithResolvers()
    const hotUpdateCalled = promiseWithResolvers()
    const loggedErrors = []
    const watchChangeEvents = []
    const hotUpdateTypes = []
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
          watchChange(id, { event }) {
            if (path.resolve(id) === stateFile) {
              watchChangeEvents.push(event)
              throw watchChangeError
            }
          },
          hotUpdate({ file, type }) {
            if (path.resolve(file) === stateFile) {
              hotUpdateTypes.push(type)
              hotUpdateCalled.resolve()
              return []
            }
          },
        },
      ],
      server: { middlewareMode: true, ws: false },
    })
    onTestFinished(() => server.close())

    server.watcher.emit(watcherEvent, stateFile)

    await withTimeout(loggedError.promise, 'watchChange error was not logged')
    await withTimeout(hotUpdateCalled.promise, 'hotUpdate hook was not reached')

    expect(loggedErrors).toContain(watchChangeError)
    expect(watchChangeEvents).toContain(expectedType)
    expect(hotUpdateTypes).toContain(expectedType)
  },
)

test('settles every watchChange hook before HMR and preserves barriers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-watch-change-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const stateFile = path.join(root, 'state.txt')
  await writeProject(root, { 'state.txt': 'alpha\n' })

  const fastError = new Error('fast watchChange rejection')
  const slowError = new Error('slow watchChange rejection')
  const slowStarted = promiseWithResolvers()
  const releaseSlow = promiseWithResolvers()
  const fastLogged = promiseWithResolvers()
  const hotUpdateCalled = promiseWithResolvers()
  const events = []
  const loggedErrors = []

  const logger = createLogger('silent')
  logger.error = (error) => {
    loggedErrors.push(error)
    if (error === fastError) fastLogged.resolve()
  }

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    customLogger: logger,
    plugins: [
      {
        name: 'fast-watch-change',
        async watchChange(id) {
          if (path.resolve(id) !== stateFile) return
          events.push('fast:start')
          await slowStarted.promise
          events.push('fast:error')
          throw fastError
        },
      },
      {
        name: 'slow-watch-change',
        async watchChange(id) {
          if (path.resolve(id) !== stateFile) return
          events.push('slow:start')
          slowStarted.resolve()
          await releaseSlow.promise
          events.push('slow:error')
          throw slowError
        },
      },
      {
        name: 'sequential-watch-change',
        watchChange: {
          sequential: true,
          handler(id) {
            if (path.resolve(id) === stateFile) events.push('sequential')
          },
        },
      },
      {
        name: 'later-watch-change',
        watchChange(id) {
          if (path.resolve(id) === stateFile) events.push('later')
        },
      },
      {
        name: 'watch-change-observer',
        hotUpdate({ file }) {
          if (this.environment.name !== 'client') return
          if (path.resolve(file) === stateFile) {
            events.push('hmr')
            hotUpdateCalled.resolve()
            return []
          }
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(async () => {
    releaseSlow.resolve()
    await server.close()
  })

  server.watcher.emit('change', stateFile)

  await withTimeout(fastLogged.promise, 'fast error was not logged')
  await new Promise((resolve) => setImmediate(resolve))
  expect(events).toEqual(['fast:start', 'slow:start', 'fast:error'])

  releaseSlow.resolve()
  await withTimeout(hotUpdateCalled.promise, 'hotUpdate hook was not reached')

  expect(loggedErrors).toEqual([fastError, slowError])
  expect(events).toEqual([
    'fast:start',
    'slow:start',
    'fast:error',
    'slow:error',
    'sequential',
    'later',
    'hmr',
  ])
})

test('continues later watchChange hooks after a synchronous error', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-watch-change-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const stateFile = path.join(root, 'state.txt')
  await writeProject(root, { 'state.txt': 'alpha\n' })

  const watchChangeError = new Error('synchronous watchChange rejection')
  const hotUpdateCalled = promiseWithResolvers()
  const loggedErrors = []
  let laterWatchChangeCalled = false

  const logger = createLogger('silent')
  logger.error = (error) => loggedErrors.push(error)

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    customLogger: logger,
    plugins: [
      {
        name: 'throwing-watch-change',
        watchChange(id) {
          if (path.resolve(id) === stateFile) throw watchChangeError
        },
      },
      {
        name: 'later-watch-change',
        watchChange(id) {
          if (path.resolve(id) === stateFile) laterWatchChangeCalled = true
        },
      },
      {
        name: 'watch-change-observer',
        hotUpdate({ file }) {
          if (this.environment.name !== 'client') return
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

  server.watcher.emit('change', stateFile)

  await withTimeout(hotUpdateCalled.promise, 'hotUpdate hook was not reached')
  expect(laterWatchChangeCalled).toBe(true)
  expect(loggedErrors).toContain(watchChangeError)
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

test('watchChange hook can await server.restart without self-deadlocking', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-watch-change-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const stateFile = path.join(root, 'state.txt')
  await writeProject(root, { 'state.txt': 'alpha\n' })

  const entered = promiseWithResolvers()
  const finished = promiseWithResolvers()
  const serverRef = {}
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'restart-in-watch-change',
        async watchChange(id) {
          if (path.resolve(id) !== stateFile) return
          entered.resolve()
          if (!serverRef.current) throw new Error('missing test server')
          await serverRef.current.restart()
          finished.resolve()
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  serverRef.current = server
  onTestFinished(() => server.close())

  server.watcher.emit('change', stateFile)
  await withTimeout(entered.promise, 'watchChange hook was not reached')
  await withTimeout(finished.promise, 'watchChange restart self-deadlocked')
})

test('direct pluginContainer.watchChange remains fail-fast', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-watch-change-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const stateFile = path.join(root, 'state.txt')
  await writeProject(root, { 'state.txt': 'alpha\n' })
  const watchChangeError = new Error('direct watchChange rejection')

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'direct-watch-change-rejection',
        watchChange(id) {
          if (path.resolve(id) === stateFile) throw watchChangeError
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await expect(
    server.environments.client.pluginContainer.watchChange(stateFile, {
      event: 'update',
    }),
  ).rejects.toBe(watchChangeError)
})
