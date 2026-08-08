import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

async function runFailedPreview(stage: 'hook' | 'post-hook') {
  const viteUrl = new URL('../../../dist/node/index.js', import.meta.url).href
  const script = `
    import { preview } from ${JSON.stringify(viteUrl)}

    const stage = ${JSON.stringify(stage)}
    const before = process.listenerCount('SIGTERM')
    let message = ''
    try {
      await preview({
        configFile: false,
        root: process.cwd(),
        logLevel: 'silent',
        preview: { port: 0 },
        plugins: [{
          name: 'test:fail-configure-preview-server',
          configurePreviewServer() {
            if (stage === 'hook') {
              throw new Error('configurePreviewServer failed')
            }
            return () => {
              throw new Error('configurePreviewServer post hook failed')
            }
          },
        }],
      })
    } catch (error) {
      message = error.message
    }

    const after = process.listenerCount('SIGTERM')
    console.log(JSON.stringify({ before, after, message }))
  `

  const { stdout } = await execFileAsync(
    process.execPath,
    ['--input-type=module', '-e', script],
    {
      cwd: process.cwd(),
      env: { ...process.env, CI: 'true' },
    },
  )

  return JSON.parse(stdout.trim().split('\n').at(-1)!)
}

test('removes shutdown state when configurePreviewServer fails', async () => {
  const result = await runFailedPreview('hook')
  expect(result.message).toBe('configurePreviewServer failed')
  expect(result.after).toBe(result.before)
})

test('removes shutdown state when a configurePreviewServer post hook fails', async () => {
  const result = await runFailedPreview('post-hook')
  expect(result.message).toBe('configurePreviewServer post hook failed')
  expect(result.after).toBe(result.before)
})
