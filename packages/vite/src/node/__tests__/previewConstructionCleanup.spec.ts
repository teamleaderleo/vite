import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

test('removes shutdown state when configurePreviewServer fails', async () => {
  const viteUrl = new URL('../../../dist/node/index.js', import.meta.url).href
  const script = `
    import { preview } from ${JSON.stringify(viteUrl)}

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
            throw new Error('configurePreviewServer failed')
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

  const result = JSON.parse(stdout.trim().split('\n').at(-1)!)
  expect(result.message).toBe('configurePreviewServer failed')
  expect(result.after).toBe(result.before)
})
