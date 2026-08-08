import { afterEach, expect, test } from 'vitest'
import type { ViteDevServer } from '..'
import { createServer } from '..'

let server: ViteDevServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

test('closes a replacement watcher when configureServer fails during restart', async () => {
  let configureCalls = 0
  let replacementWatcher: ViteDevServer['watcher'] | undefined
  let originalClose: (() => Promise<void>) | undefined
  let closeCalls = 0

  server = await createServer({
    configFile: false,
    root: import.meta.dirname,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    plugins: [
      {
        name: 'test:fail-configure-on-restart',
        configureServer(candidate) {
          if (configureCalls++ === 0) return
          replacementWatcher = candidate.watcher
          originalClose = candidate.watcher.close.bind(candidate.watcher)
          candidate.watcher.close = async () => {
            closeCalls++
            await originalClose!()
          }
          throw new Error('restart configureServer failed')
        },
      },
    ],
  })

  try {
    await server.restart()
    expect(closeCalls).toBe(1)
  } finally {
    if (closeCalls === 0) await originalClose?.()
    replacementWatcher = undefined
  }
})
