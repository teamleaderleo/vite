import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test, vi } from 'vitest'
import { build } from '../../build'
import { createServer } from '../../server'
import { updateModules } from '../../server/hmr'

test('research: post-order transform import escapes dev graph analysis', async () => {
  const normal = await runScenario()
  const post = await runScenario('post')

  expect(normal).toMatchObject({
    hookOrder: 'normal',
    graphContainsInjectedDependency: true,
    graphContainsInjectedAcceptBoundary: true,
    devOutputContainsInjectedImport: true,
    devOutputHasHotContext: true,
    hmrPayloadType: 'update',
    buildOutputContainsDependencySentinel: true,
  })

  expect(post).toMatchObject({
    hookOrder: 'post',
    graphContainsInjectedDependency: false,
    graphContainsInjectedAcceptBoundary: false,
    devOutputContainsInjectedImport: true,
    devOutputHasHotContext: false,
    hmrPayloadType: 'full-reload',
    buildOutputContainsDependencySentinel: true,
  })
})

async function runScenario(order) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-post-transform-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "console.log('main')",
    'src/dep.js': "export const dep = 'FIELDWORK_DEP_SENTINEL'",
  })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [createImportPlugin(order)],
    server: { middlewareMode: true, ws: false },
  })

  let devCode
  let graphContainsInjectedDependency
  let graphContainsInjectedAcceptBoundary
  let hmrPayloadType

  try {
    const transformed = await server.transformRequest('/src/main.js')
    devCode = transformed?.code || ''

    await server.transformRequest('/src/dep.js')

    const environment = server.environments.client
    const main = await environment.moduleGraph.getModuleByUrl('/src/main.js')
    const dep = await environment.moduleGraph.getModuleByUrl('/src/dep.js')

    expect(main).toBeTruthy()
    expect(dep).toBeTruthy()

    graphContainsInjectedDependency = main.importedModules.has(dep)
    graphContainsInjectedAcceptBoundary = main.acceptedHmrDeps.has(dep)

    const payloads = []
    vi.spyOn(environment.hot, 'send').mockImplementation((payload) => {
      payloads.push(payload)
    })

    updateModules(environment, 'src/dep.js', [dep], Date.now())
    expect(payloads).toHaveLength(1)
    hmrPayloadType = payloads[0].type
  } finally {
    await server.close()
  }

  const output = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [createImportPlugin(order)],
    build: { write: false },
  })
  const outputs = Array.isArray(output) ? output : [output]
  const buildCode = outputs
    .flatMap((entry) => ('output' in entry ? entry.output : []))
    .filter((entry) => entry.type === 'chunk')
    .map((entry) => entry.code)
    .join('\n')

  return {
    hookOrder: order || 'normal',
    graphContainsInjectedDependency,
    graphContainsInjectedAcceptBoundary,
    devOutputContainsInjectedImport: devCode.includes('dep.js'),
    devOutputHasHotContext: devCode.includes('__vite__createHotContext'),
    hmrPayloadType,
    buildOutputContainsDependencySentinel: buildCode.includes(
      'FIELDWORK_DEP_SENTINEL',
    ),
  }
}

function createImportPlugin(order) {
  const handler = (code, id) => {
    if (!normalizePath(id).endsWith('/src/main.js')) return
    return [
      code,
      "import { dep } from './dep.js'",
      'console.log(dep)',
      "if (import.meta.hot) import.meta.hot.accept('./dep.js', () => {})",
    ].join('\n')
  }

  return {
    name: `fieldwork-inject-import-${order || 'normal'}`,
    transform: order ? { order, handler } : handler,
  }
}

async function writeProject(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filename = path.join(root, relativePath)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content)
  }
}

function normalizePath(filename) {
  return filename.split(path.sep).join('/')
}
