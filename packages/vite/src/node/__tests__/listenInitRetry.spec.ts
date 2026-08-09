import { createServer as createNetServer } from 'node:net'
import { expect, test } from 'vitest'
import type { ViteDevServer } from '..'
import { DevEnvironment, createServer } from '..'

function transientListenEnvironment() {
  let listenCalls = 0

  class TransientListenEnvironment extends DevEnvironment {
    override async listen(server: ViteDevServer) {
      listenCalls++
      if (listenCalls === 1) {
        throw new Error('first environment listen failed')
      }
      await super.listen(server)
    }
  }

  return {
    createEnvironment(
      name: string,
      config: ConstructorParameters<typeof DevEnvironment>[1],
      context: {
        ws: ConstructorParameters<typeof DevEnvironment>[2]['transport']
      },
    ) {
      return new TransientListenEnvironment(name, config, {
        hot: true,
        transport: context.ws,
        disableFetchModule: true,
      })
    },
    getListenCalls: () => listenCalls,
  }
}

test('retries server initialization after a transient environment listen failure', async () => {
  let server: ViteDevServer | undefined
  const { createEnvironment, getListenCalls } = transientListenEnvironment()

  try {
    server = await createServer({
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: { host: '127.0.0.1', watch: null, ws: false },
      environments: {
        client: { dev: { createEnvironment } },
      },
    })

    await expect(server.listen(0)).rejects.toThrow(
      'first environment listen failed',
    )
    await expect(server.listen(0)).resolves.toBe(server)
    expect(getListenCalls()).toBe(2)
  } finally {
    await server?.close()
  }
})

test('removes the resolved-url listener after an initialization failure', async () => {
  let server: ViteDevServer | undefined
  const { createEnvironment } = transientListenEnvironment()

  try {
    server = await createServer({
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: { host: '127.0.0.1', watch: null, ws: false },
      environments: {
        client: { dev: { createEnvironment } },
      },
    })

    const httpServer = server.httpServer!
    const listenersBefore = httpServer.listenerCount('listening')
    await expect(server.listen(0)).rejects.toThrow(
      'first environment listen failed',
    )
    expect(httpServer.listenerCount('listening')).toBe(listenersBefore)
  } finally {
    await server?.close()
  }
})

test('removes the resolved-url listener after an HTTP startup failure', async () => {
  const blocker = createNetServer()
  let server: ViteDevServer | undefined

  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject)
    blocker.listen(0, '127.0.0.1', resolve)
  })
  const port = (blocker.address() as { port: number }).port

  try {
    server = await createServer({
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: {
        host: '127.0.0.1',
        port,
        strictPort: true,
        watch: null,
        ws: false,
      },
    })

    const httpServer = server.httpServer!
    const listenersBefore = httpServer.listenerCount('listening')
    await expect(server.listen()).rejects.toThrow('already in use')
    expect(httpServer.listenerCount('listening')).toBe(listenersBefore)

    await new Promise<void>((resolve) => blocker.close(() => resolve()))
    await expect(server.listen()).resolves.toBe(server)
  } finally {
    if (blocker.listening) {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
    await server?.close()
  }
})
