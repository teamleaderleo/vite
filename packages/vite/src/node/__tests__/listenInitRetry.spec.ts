import { expect, test } from 'vitest'
import type { ViteDevServer } from '..'
import { createServer } from '..'

test('retries server initialization after a transient buildStart failure', async () => {
  let server: ViteDevServer | undefined
  let buildStartCalls = 0

  try {
    server = await createServer({
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: { host: '127.0.0.1', watch: null, ws: false },
      plugins: [
        {
          name: 'test:transient-build-start-failure',
          buildStart() {
            buildStartCalls++
            if (buildStartCalls === 1) {
              throw new Error('first buildStart failed')
            }
          },
        },
      ],
    })

    await expect(server.listen(0)).rejects.toThrow('first buildStart failed')
    await expect(server.listen(0)).resolves.toBe(server)
    expect(buildStartCalls).toBe(2)
  } finally {
    await server?.close()
  }
})
