import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const targetRevision = '8a245726944ed29225920d49be77c33c6e03afc8'
const { createLogger, createServer } = await import('vite')

const control = await runScenario(false)
const rejection = await runScenario(true)

assert.equal(control.invalidatedAfterEvent, true)
assert.equal(control.refreshedValue, 'beta')
assert.equal(rejection.loggedError, true)
assert.equal(rejection.invalidatedAfterEvent, false)
assert.equal(rejection.refreshedValue, 'alpha')

process.stdout.write(
  `${JSON.stringify(
    {
      targetRevision,
      node: process.version,
      status: 'candidate-reproduced',
      control,
      rejection,
    },
    null,
    2,
  )}\n`,
)

async function runScenario(rejectWatchChange) {
  return withProject(async (root) => {
    const stateFile = path.join(root, 'state.txt')
    const virtualId = '\0virtual:fieldwork-state'

    await writeProject(root, {
      'index.html': '<script type="module" src="/src/main.js"></script>',
      'src/main.js': [
        "import { value } from 'virtual:fieldwork-state'",
        'console.log(value)',
        "if (import.meta.hot) import.meta.hot.accept('virtual:fieldwork-state', () => {})",
      ].join('\n'),
      'state.txt': 'alpha\n',
    })

    const logger = createLogger('silent')
    let resolveLoggedError
    const loggedError = new Promise((resolve) => {
      resolveLoggedError = resolve
    })
    logger.error = () => resolveLoggedError(true)

    const plugin = {
      name: 'fieldwork-state-plugin',
      resolveId(id) {
        if (id === 'virtual:fieldwork-state') return virtualId
      },
      async load(id) {
        if (id !== virtualId) return
        this.addWatchFile(stateFile)
        const value = (await readFile(stateFile, 'utf8')).trim()
        return `export const value = ${JSON.stringify(value)}`
      },
      watchChange(id) {
        if (rejectWatchChange && path.resolve(id) === stateFile) {
          throw new Error('fieldwork-watchChange-rejection')
        }
      },
    }

    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      customLogger: logger,
      plugins: [plugin],
      server: { middlewareMode: true, ws: false },
    })

    try {
      await server.transformRequest('/src/main.js')

      const virtualUrl = '/@id/__x00__virtual:fieldwork-state'
      const first = await server.transformRequest(virtualUrl)
      assert.match(first?.code || '', /alpha/)

      const environment = server.environments.client
      const mod = environment.moduleGraph.getModuleById(virtualId)
      assert.ok(mod)
      assert.ok(mod.transformResult)
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
          () => mod.transformResult === null,
          2_000,
          'module was not invalidated',
        )
      }

      const invalidatedAfterEvent = mod.transformResult === null
      if (rejectWatchChange) {
        assert.equal(mod.transformResult, previousTransform)
      }

      const refreshed = await server.transformRequest(virtualUrl)
      const refreshedValue = /beta/.test(refreshed?.code || '') ? 'beta' : 'alpha'

      return {
        rejectWatchChange,
        loggedError: didLogError,
        invalidatedAfterEvent,
        refreshedValue,
      }
    } finally {
      await server.close()
    }
  })
}

async function withProject(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fieldwork-vite-'))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
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
