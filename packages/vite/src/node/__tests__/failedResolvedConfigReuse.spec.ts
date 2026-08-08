import { expect, test } from 'vitest'
import { createServer, resolveConfig } from '..'

test('allows a resolved config to be reused after server creation fails', async () => {
  let configureCalls = 0
  const config = await resolveConfig(
    {
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false, watch: null },
      plugins: [
        {
          name: 'test:fail-first-server-creation',
          configureServer() {
            if (configureCalls++ === 0) {
              throw new Error('first server creation failed')
            }
          },
        },
      ],
    },
    'serve',
  )

  await expect(createServer(config)).rejects.toThrow('first server creation failed')

  const server = await createServer(config)
  try {
    expect(configureCalls).toBe(2)
  } finally {
    await server.close()
  }
})

test('does not retain the config marker when HTTPS server creation fails', async () => {
  const config = await resolveConfig(
    {
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: {
        https: {
          key: 'not a private key',
          cert: 'not a certificate',
        },
        ws: false,
        watch: null,
      },
    },
    'serve',
  )

  const firstError = await createServer(config).catch((error) => error as Error)
  expect(firstError).toBeInstanceOf(Error)
  expect(firstError.message).not.toContain('already a server associated')

  const secondError = await createServer(config).catch((error) => error as Error)
  expect(secondError).toBeInstanceOf(Error)
  expect(secondError.message).toBe(firstError.message)
})
