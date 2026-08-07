import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, test } from 'vitest'
import type { ViteDevServer } from '../..'
import { createServer } from '../..'

const servers = new Set<ViteDevServer>()
let root: string | undefined

afterEach(async () => {
  await Promise.allSettled([...servers].map((server) => server.close()))
  servers.clear()
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test('waits for active dependency optimizer output before close resolves', async () => {
  root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'vite-optimizer-close-'),
  )
  const cacheDir = path.join(root, '.vite')
  const dep = path.join(root, 'dep.js')
  fs.writeFileSync(dep, 'export const marker = "close-probe"\n')

  const outputStarted = deferred()
  const releaseOutput = deferred()

  const server = await createServer({
    configFile: false,
    root,
    cacheDir,
    logLevel: 'silent',
    resolve: {
      alias: {
        dep,
      },
    },
    optimizeDeps: {
      force: true,
      include: ['dep'],
      noDiscovery: false,
      rolldownOptions: {
        plugins: [
          {
            name: 'test:block-dependency-optimizer-output',
            async generateBundle() {
              outputStarted.resolve()
              await releaseOutput.promise
              throw new Error('stop optimizer output after close probe')
            },
          },
        ],
      },
    },
    server: {
      middlewareMode: true,
      ws: false,
    },
  })
  servers.add(server)

  await outputStarted.promise

  const closePromise = server.close()
  const closedBeforeRelease = await Promise.race([
    closePromise.then(() => true),
    delay(50, false),
  ])

  try {
    expect(closedBeforeRelease).toBe(false)
  } finally {
    releaseOutput.resolve()
    await Promise.allSettled([closePromise])
    servers.delete(server)
    // Let the intentionally stopped background optimizer unwind before cleanup.
    await delay(50)
  }
})
