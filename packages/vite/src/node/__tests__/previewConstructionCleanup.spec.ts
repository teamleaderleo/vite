import { expect, test } from 'vitest'
import { preview } from '..'

test('removes the SIGTERM listener when configurePreviewServer fails', async () => {
  const existingListeners = new Set(process.listeners('SIGTERM'))

  try {
    await expect(
      preview({
        configFile: false,
        root: import.meta.dirname,
        logLevel: 'silent',
        preview: {
          port: 0,
        },
        plugins: [
          {
            name: 'test:fail-configure-preview-server',
            configurePreviewServer() {
              throw new Error('configurePreviewServer failed')
            },
          },
        ],
      }),
    ).rejects.toThrow('configurePreviewServer failed')

    const leakedListeners = process
      .listeners('SIGTERM')
      .filter((listener) => !existingListeners.has(listener))
    expect(leakedListeners).toHaveLength(0)
  } finally {
    for (const listener of process.listeners('SIGTERM')) {
      if (!existingListeners.has(listener)) {
        process.removeListener('SIGTERM', listener)
      }
    }
  }
})
