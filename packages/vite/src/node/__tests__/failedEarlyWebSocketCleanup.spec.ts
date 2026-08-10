import { createServer as createHttpServer } from 'node:http'
import { expect, test } from 'vitest'
import { createServer } from '..'

test('removes the custom HMR server listener when public-dir init fails', async () => {
  const hmrServer = createHttpServer()
  const listenersBefore = hmrServer.listenerCount('upgrade')

  try {
    await expect(
      createServer({
        configFile: false,
        root: import.meta.dirname,
        publicDir: import.meta.filename,
        logLevel: 'silent',
        server: {
          middlewareMode: true,
          watch: null,
          ws: { server: hmrServer },
        },
      }),
    ).rejects.toMatchObject({ code: 'ENOTDIR' })

    expect(hmrServer.listenerCount('upgrade')).toBe(listenersBefore)
  } finally {
    hmrServer.removeAllListeners()
  }
})
