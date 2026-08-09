import { expect, test } from 'vitest'
import { DevEnvironment, createServer } from '..'

test('preserves the construction error when environment cleanup fails', async () => {
  class FailingCloseEnvironment extends DevEnvironment {
    override async close() {
      throw new Error('environment cleanup failed')
    }
  }

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
              return new FailingCloseEnvironment(name, config, {
                hot: true,
                transport: context.ws,
                disableFetchModule: true,
              })
            },
          },
        },
      },
      plugins: [
        {
          name: 'test:fail-configure-server',
          configureServer() {
            throw new Error('configureServer failed')
          },
        },
      ],
    }),
  ).rejects.toThrow('configureServer failed')
})
