import { expect, it } from 'vitest'
import type { UserConfig } from '../../config'
import { resolveConfig } from '../../config'
import type { Plugin } from '../../plugin'
import { DevEnvironment } from '../environment'

it('runs closeBundle when buildEnd fails', async () => {
  const events: string[] = []
  const buildEndError = new Error('buildEnd failed')
  const environment = await getDevEnvironment({
    plugins: [
      {
        name: 'failing-build-end',
        buildEnd() {
          events.push('buildEnd')
          throw buildEndError
        },
      },
      {
        name: 'close-bundle-cleanup',
        closeBundle() {
          events.push('closeBundle')
        },
      },
    ],
  })

  await expect(environment.pluginContainer.close()).rejects.toBe(buildEndError)
  expect(events).toEqual(['buildEnd', 'closeBundle'])
})

it('retains buildEnd and closeBundle failures', async () => {
  const events: string[] = []
  const buildEndError = new Error('buildEnd failed')
  const closeBundleError = new Error('closeBundle failed')
  const environment = await getDevEnvironment({
    plugins: [
      {
        name: 'failing-lifecycle-hooks',
        buildEnd() {
          events.push('buildEnd')
          throw buildEndError
        },
        closeBundle() {
          events.push('closeBundle')
          throw closeBundleError
        },
      },
    ],
  })

  let closeError: unknown
  try {
    await environment.pluginContainer.close()
  } catch (error) {
    closeError = error
  }

  expect(closeError).toBeInstanceOf(AggregateError)
  expect((closeError as AggregateError).errors).toEqual([
    buildEndError,
    closeBundleError,
  ])
  expect(events).toEqual(['buildEnd', 'closeBundle'])
})

async function getDevEnvironment(
  inlineConfig?: UserConfig,
): Promise<DevEnvironment> {
  const config = await resolveConfig(
    { configFile: false, ...inlineConfig },
    'serve',
  )

  // @ts-expect-error This plugin requires a ViteDevServer instance.
  config.plugins = config.plugins.filter(
    (plugin) => !plugin.name.includes('pre-alias'),
  )

  const environment = new DevEnvironment('client', config, { hot: true })
  await environment.init()
  return environment
}
