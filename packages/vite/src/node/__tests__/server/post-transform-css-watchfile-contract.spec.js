import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { createServer } from '../../server'

test('CSS analysis records watch files added by a post transform', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-css-post-watch-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const watchedFile = path.join(root, 'src', 'tokens.css')
  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': "import './main.css'",
    'src/main.css': '.button { color: red; }',
    'src/tokens.css': ':root { --button-color: red; }',
  })

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'post-css-watch-file',
        transform: {
          order: 'post',
          handler(_code, id) {
            if (normalizePath(id).endsWith('/src/main.css')) {
              this.addWatchFile(watchedFile)
            }
          },
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await server.transformRequest('/src/main.css')

  const main = await server.environments.client.moduleGraph.getModuleByUrl(
    '/src/main.css',
  )
  expect(main).toBeTruthy()
  expect(
    [...main.importedModules].some(
      (dependency) => dependency.file === normalizePath(watchedFile),
    ),
  ).toBe(true)
})

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
