import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

async function runFailedPreview(stage: 'hook' | 'post-hook' | 'port') {
  const viteUrl = new URL('../../../dist/node/index.js', import.meta.url).href
  const script = `
    import { createServer as createNetServer } from 'node:net'
    import { preview } from ${JSON.stringify(viteUrl)}

    const stage = ${JSON.stringify(stage)}
    let blocker
    let port = 0
    if (stage === 'port') {
      blocker = createNetServer()
      await new Promise((resolve, reject) => {
        blocker.once('error', reject)
        blocker.listen(0, '127.0.0.1', resolve)
      })
      port = blocker.address().port
    }

    const before = process.listenerCount('SIGTERM')
    let message = ''
    try {
      await preview({
        configFile: false,
        root: process.cwd(),
        logLevel: 'silent',
        preview: {
          host: '127.0.0.1',
          port,
          strictPort: stage === 'port',
        },
        plugins: stage === 'port' ? [] : [{
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
    } finally {
      if (blocker) {
        await new Promise((resolve) => blocker.close(resolve))
      }
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

test('removes shutdown state when preview HTTP startup fails', async () => {
  const result = await runFailedPreview('port')
  expect(result.message).toContain('already in use')
  expect(result.after).toBe(result.before)
})
