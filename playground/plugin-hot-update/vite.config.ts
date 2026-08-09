import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { type Plugin, defineConfig } from 'vite'

const publicId = 'virtual:plugin-state'
const resolvedId = `\0${publicId}`
const stateFile = path.resolve(import.meta.dirname, 'plugin-state.txt')

export default defineConfig({
  plugins: [pluginHotUpdateState()],
})

function pluginHotUpdateState(): Plugin {
  return {
    name: 'plugin-hot-update-state',
    configureServer(server) {
      // Register the external state with Vite's filesystem watcher without
      // adding it to the module or bundled dependency graph. The plugin owns
      // the browser update through its hotUpdate custom event.
      server.watcher.add(stateFile)
    },
    resolveId(id) {
      if (id === publicId) return resolvedId
    },
    async load(id) {
      if (id !== resolvedId) return
      const value = (await readFile(stateFile, 'utf8')).trim()
      return `export const value = ${JSON.stringify(value)}`
    },
    watchChange(id) {
      if (
        this.environment.name !== 'client' ||
        path.resolve(id) !== stateFile
      ) {
        return
      }
      this.environment.hot.send({
        type: 'custom',
        event: 'fieldwork:watch-seen',
        data: {},
      })
    },
    async hotUpdate({ file, read }) {
      if (
        this.environment.name !== 'client' ||
        path.resolve(file) !== stateFile
      ) {
        return
      }
      const value = (await read()).trim()
      this.environment.hot.send({
        type: 'custom',
        event: 'fieldwork:state',
        data: { value },
      })
      return []
    },
  }
}
