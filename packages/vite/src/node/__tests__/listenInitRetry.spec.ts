import { expect, test } from 'vitest'
import type { ViteDevServer } from '..'
import { createServer } from '..'

function transientBuildStartPlugin() {
  let buildStartCalls = 0
  return {
    plugin: {
      name: 'test:transient-build-start-failure',
      buildStart() {
        buildStartCalls++
        if (buildStartCalls === 1) {
          throw new Error('first buildStart failed')
        }
      },
    },
    getBuildStartCalls: () => buildStartCalls,
  }
}

test('retries server initialization after a transient buildStart failure', async () => {
  let server: ViteDevServer | undefined
  const { plugin, getBuildStartCalls } = transientBuildStartPlugin()

  try {
    server = await createServer({
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: { host: '127.0.0.1', watch: null, ws: false },
      plugins: [plugin],
    })

    await expect(server.listen(0)).rejects.toThrow('first buildStart failed')
    await expect(server.listen(0)).resolves.toBe(server)
    expect(getBuildStartCalls()).toBe(2)
  } finally {
    await server?.close()
  }
})

test('removes the resolved-url listener after a failed listen attempt', async () => {
  let server: ViteDevServer | undefined
  const { plugin } = transientBuildStartPlugin()

  try {
    server = await createServer({
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: { host: '127.0.0.1', watch: null, ws: false },
      plugins: [plugin],
    })

    const httpServer = server.httpServer!
    const listenersBefore = httpServer.listenerCount('listening')
    await expect(server.listen(0)).rejects.toThrow('first buildStart failed')
    expect(httpServer.listenerCount('listening')).toBe(listenersBefore)
  } finally {
    await server?.close()
  }
})
