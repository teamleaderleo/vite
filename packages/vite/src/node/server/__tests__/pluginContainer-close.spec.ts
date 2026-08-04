import { expect, it } from 'vitest'
import type { UserConfig } from '../../config'
import { resolveConfig } from '../../config'
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

it('waits for all buildEnd hooks before closeBundle after a failure', async () => {
  const events: string[] = []
  const buildEndError = new Error('buildEnd failed')
  let releasePendingBuildEnd!: () => void
  const pendingBuildEnd = new Promise<void>((resolve) => {
    releasePendingBuildEnd = resolve
  })
  const environment = await getDevEnvironment({
    plugins: [
      {
        name: 'pending-build-end',
        async buildEnd() {
          events.push('pending buildEnd started')
          await pendingBuildEnd
          events.push('pending buildEnd finished')
        },
      },
      {
        name: 'failing-build-end',
        buildEnd() {
          events.push('failing buildEnd')
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

  const closePromise = environment.pluginContainer.close()
  await Promise.resolve()
  await Promise.resolve()

  expect(events).toContain('pending buildEnd started')
  expect(events).toContain('failing buildEnd')
  expect(events).not.toContain('closeBundle')

  releasePendingBuildEnd()

  await expect(closePromise).rejects.toBe(buildEndError)
  expect(events.indexOf('pending buildEnd finished')).toBeLessThan(
    events.indexOf('closeBundle'),
  )
})

it('continues sequential lifecycle hooks and retains ordered failures', async () => {
  const events: string[] = []
  const buildEndError = new Error('buildEnd failed')
  const closeBundleError = new Error('closeBundle failed')
  const environment = await getDevEnvironment({
    plugins: [
      {
        name: 'failing-parallel-hooks',
        buildEnd() {
          events.push('failing parallel buildEnd')
          throw buildEndError
        },
        closeBundle() {
          events.push('failing parallel closeBundle')
          throw closeBundleError
        },
      },
      {
        name: 'sequential-hooks-after-failure',
        buildEnd: {
          sequential: true,
          handler() {
            events.push('sequential buildEnd')
          },
        },
        closeBundle: {
          sequential: true,
          handler() {
            events.push('sequential closeBundle')
          },
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
  expect(events).toEqual([
    'failing parallel buildEnd',
    'sequential buildEnd',
    'failing parallel closeBundle',
    'sequential closeBundle',
  ])
})

it('orders parallel failures by invocation order, not rejection timing', async () => {
  const events: string[] = []
  const firstError = new Error('first buildEnd failed')
  const secondError = new Error('second buildEnd failed')
  let releaseFirstBuildEnd!: () => void
  const firstBuildEndGate = new Promise<void>((resolve) => {
    releaseFirstBuildEnd = resolve
  })
  const environment = await getDevEnvironment({
    plugins: [
      {
        name: 'first-slow-failing-build-end',
        async buildEnd() {
          events.push('first buildEnd started')
          await firstBuildEndGate
          events.push('first buildEnd failed')
          throw firstError
        },
      },
      {
        name: 'second-fast-failing-build-end',
        buildEnd() {
          events.push('second buildEnd failed')
          throw secondError
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

  const closePromise = environment.pluginContainer.close()
  await Promise.resolve()
  await Promise.resolve()

  expect(events).toEqual(['first buildEnd started', 'second buildEnd failed'])

  releaseFirstBuildEnd()

  let closeError: unknown
  try {
    await closePromise
  } catch (error) {
    closeError = error
  }

  expect(closeError).toBeInstanceOf(AggregateError)
  expect((closeError as AggregateError).errors).toEqual([
    firstError,
    secondError,
  ])
  expect(events).toEqual([
    'first buildEnd started',
    'second buildEnd failed',
    'first buildEnd failed',
    'closeBundle',
  ])
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
