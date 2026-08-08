import { expect, test } from 'vitest'
import { DevEnvironment, resolveConfig } from '..'

test('can close a dev environment after plugin container init fails', async () => {
  const config = await resolveConfig(
    {
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      plugins: [
        {
          name: 'test:fail-environment-plugin-container-init',
          options() {
            throw new Error('plugin container init failed')
          },
        },
      ],
    },
    'serve',
  )

  const environment = new DevEnvironment('client', config, {
    hot: false,
  })

  await expect(environment.init()).rejects.toThrow('plugin container init failed')
  await expect(environment.close()).resolves.toBeUndefined()
})
