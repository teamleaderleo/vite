import { createServer as createHttpServer } from 'node:http'
import { expect, test } from 'vitest'
import type { ViteDevServer } from '..'
import { createServer } from '..'

test('removes the proxy upgrade listener from a parent server on close', async () => {
  const parentServer = createHttpServer()
  const listenersBefore = parentServer.listenerCount('upgrade')
  let server: ViteDevServer | undefined

  try {
    server = await createServer({
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: {
        middlewareMode: { server: parentServer },
        watch: null,
        ws: false,
        proxy: {
          '/socket': {
            target: 'ws://127.0.0.1:1',
            ws: true,
          },
        },
      },
    })

    expect(parentServer.listenerCount('upgrade')).toBe(listenersBefore + 1)

    await server.close()
    expect(parentServer.listenerCount('upgrade')).toBe(listenersBefore)
  } finally {
    await server?.close()
    parentServer.removeAllListeners()
  }
})

test('removes the HMR upgrade listener from a custom server on close', async () => {
  const parentServer = createHttpServer()
  const listenersBefore = parentServer.listenerCount('upgrade')
  let server: ViteDevServer | undefined

  try {
    server = await createServer({
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: {
        middlewareMode: true,
        watch: null,
        ws: { server: parentServer },
      },
    })

    expect(parentServer.listenerCount('upgrade')).toBe(listenersBefore + 1)

    await server.close()
    expect(parentServer.listenerCount('upgrade')).toBe(listenersBefore)
  } finally {
    await server?.close()
    parentServer.removeAllListeners()
  }
})
