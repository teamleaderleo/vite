import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from 'vitest'
import { DevEnvironment, createServer } from '..'

test('waits for in-flight environment listen before closing after a sibling failure', async () => {
  let markSlowListenStarted!: () => void
  const slowListenStarted = new Promise<void>((resolve) => {
    markSlowListenStarted = resolve
  })
  const events: string[] = []
  let slowEnvironment: DevEnvironment | undefined

  class SlowEnvironment extends DevEnvironment {
    override async listen() {
      markSlowListenStarted()
      await delay(50)
      events.push('listen-finished')
    }

    override async close() {
      events.push('close')
      await super.close()
    }
  }

  class FailingEnvironment extends DevEnvironment {
    override async listen() {
      await slowListenStarted
      throw new Error('sibling environment listen failed')
    }
  }

  try {
    await expect(
      createServer({
        configFile: false,
        root: import.meta.dirname,
        logLevel: 'silent',
        server: { middlewareMode: true, ws: false, watch: null },
        environments: {
          client: {
            dev: {
              createEnvironment(name, config, context) {
                slowEnvironment = new SlowEnvironment(name, config, {
                  hot: true,
                  transport: context.ws,
                  disableFetchModule: true,
                })
                return slowEnvironment
              },
            },
          },
          broken: {
            dev: {
              createEnvironment(name, config) {
                return new FailingEnvironment(name, config, { hot: false })
              },
            },
          },
        },
      }),
    ).rejects.toThrow('sibling environment listen failed')

    await delay(100)
    expect(events).toEqual(['listen-finished', 'close'])
  } finally {
    if (!events.includes('close')) await slowEnvironment?.close()
  }
})

test('settles an in-flight listen when a sibling throws synchronously', async () => {
  const events: string[] = []
  let slowEnvironment: DevEnvironment | undefined

  class SlowEnvironment extends DevEnvironment {
    override async listen() {
      await delay(50)
      events.push('listen-finished')
    }

    override async close() {
      events.push('close')
      await super.close()
    }
  }

  class SyncFailingEnvironment extends DevEnvironment {
    override listen(): Promise<void> {
      throw new Error('synchronous environment listen failed')
    }
  }

  try {
    await expect(
      createServer({
        configFile: false,
        root: import.meta.dirname,
        logLevel: 'silent',
        server: { middlewareMode: true, ws: false, watch: null },
        environments: {
          client: {
            dev: {
              createEnvironment(name, config, context) {
                slowEnvironment = new SlowEnvironment(name, config, {
                  hot: true,
                  transport: context.ws,
                  disableFetchModule: true,
                })
                return slowEnvironment
              },
            },
          },
          broken: {
            dev: {
              createEnvironment(name, config) {
                return new SyncFailingEnvironment(name, config, { hot: false })
              },
            },
          },
        },
      }),
    ).rejects.toThrow('synchronous environment listen failed')

    await delay(100)
    expect(events).toEqual(['listen-finished', 'close'])
  } finally {
    if (!events.includes('close')) await slowEnvironment?.close()
  }
})
