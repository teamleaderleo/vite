import { afterEach, expect, test } from 'vitest'
import type { ViteDevServer } from '..'
import { DevEnvironment, createServer } from '..'

let server: ViteDevServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

test('closes a replacement watcher when configureServer fails during restart', async () => {
  let configureCalls = 0
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
  }
})

test('closes the watcher when initial configureServer fails', async () => {
  let originalClose: (() => Promise<void>) | undefined
  let closeCalls = 0

  try {
    await expect(
      createServer({
        configFile: false,
        root: import.meta.dirname,
        logLevel: 'silent',
        server: { middlewareMode: true, ws: false },
        plugins: [
          {
            name: 'test:fail-initial-configure',
            configureServer(candidate) {
              originalClose = candidate.watcher.close.bind(candidate.watcher)
              candidate.watcher.close = async () => {
                closeCalls++
                await originalClose!()
              }
              throw new Error('initial configureServer failed')
            },
          },
        ],
      }),
    ).rejects.toThrow('initial configureServer failed')

    expect(closeCalls).toBe(1)
  } finally {
    if (closeCalls === 0) await originalClose?.()
  }
})

test('closes the watcher when initial buildStart fails', async () => {
  let originalClose: (() => Promise<void>) | undefined
  let closeCalls = 0

  try {
    await expect(
      createServer({
        configFile: false,
        root: import.meta.dirname,
        logLevel: 'silent',
        server: { middlewareMode: true, ws: false },
        plugins: [
          {
            name: 'test:fail-initial-build-start',
            configureServer(candidate) {
              originalClose = candidate.watcher.close.bind(candidate.watcher)
              candidate.watcher.close = async () => {
                closeCalls++
                await originalClose!()
              }
            },
            buildStart() {
              throw new Error('initial buildStart failed')
            },
          },
        ],
      }),
    ).rejects.toThrow('initial buildStart failed')

    expect(closeCalls).toBe(1)
  } finally {
    if (closeCalls === 0) await originalClose?.()
  }
})

test('closes the watcher when environment init fails', async () => {
  let originalClose: (() => Promise<void>) | undefined
  let closeCalls = 0

  class FailingInitEnvironment extends DevEnvironment {
    override async init(options?: Parameters<DevEnvironment['init']>[0]) {
      const watcher = options?.watcher
      if (!watcher) throw new Error('missing watcher')

      originalClose = watcher.close.bind(watcher)
      watcher.close = async () => {
        closeCalls++
        await originalClose!()
      }
      throw new Error('environment init failed')
    }
  }

  try {
    await expect(
      createServer({
        configFile: false,
        root: import.meta.dirname,
        logLevel: 'silent',
        server: { middlewareMode: true, ws: false },
        environments: {
          client: {
            dev: {
              createEnvironment(name, config, context) {
                return new FailingInitEnvironment(name, config, {
                  hot: true,
                  transport: context.ws,
                  disableFetchModule: true,
                })
              },
            },
          },
        },
      }),
    ).rejects.toThrow('environment init failed')

    expect(closeCalls).toBe(1)
  } finally {
    if (closeCalls === 0) await originalClose?.()
  }
})
