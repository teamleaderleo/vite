import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { createServer } from '../../server'

test('baseline post transform observes import-analysis output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-post-visibility-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await writeProject(root, {
    'index.html': '<script type="module" src="/src/main.js"></script>',
    'src/main.js': [
      "import { dep } from './dep.js'",
      'console.log(dep)',
      "if (import.meta.hot) import.meta.hot.accept('./dep.js', () => {})",
    ].join('\n'),
    'src/dep.js': "export const dep = 'dep'",
  })

  let postTransformInput
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'record-post-transform-input',
        transform: {
          order: 'post',
          handler(code, id) {
            if (normalizePath(id).endsWith('/src/main.js')) {
              postTransformInput = code
            }
          },
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await server.transformRequest('/src/main.js')

  expect(postTransformInput).toContain('__vite__createHotContext')
  expect(postTransformInput).not.toContain('if (import.meta.hot)')
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
