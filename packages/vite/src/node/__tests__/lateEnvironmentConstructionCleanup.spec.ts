import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from 'vitest'
import { DevEnvironment, createServer } from '..'

test('closes an environment returned after a sibling init already failed', async () => {
  let markDelayedFactoryStarted!: () => void
  const delayedFactoryStarted = new Promise<void>((resolve) => {
    markDelayedFactoryStarted = resolve
  })
  let delayedEnvironment: DevEnvironment | undefined
  let delayedCloseCalls = 0

  class TrackingEnvironment extends DevEnvironment {
    override async close() {
      delayedCloseCalls++
      await super.close()
    }
  }

  class FailingEnvironment extends DevEnvironment {
    override async init() {
      await delayedFactoryStarted
      throw new Error('sibling environment init failed')
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
              async createEnvironment(name, config, context) {
                markDelayedFactoryStarted()
                await delay(50)
                delayedEnvironment = new TrackingEnvironment(name, config, {
                  hot: true,
                  transport: context.ws,
                  disableFetchModule: true,
                })
                return delayedEnvironment
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
    ).rejects.toThrow('sibling environment init failed')

    // Promise.all() has already rejected, but the delayed factory task keeps
    // running and initializes its returned environment afterward.
    await delay(100)
    expect(delayedCloseCalls).toBe(1)
  } finally {
    if (delayedCloseCalls === 0) await delayedEnvironment?.close()
  }
})
