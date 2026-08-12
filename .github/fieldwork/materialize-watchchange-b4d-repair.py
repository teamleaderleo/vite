from pathlib import Path

PLUGIN = Path('packages/vite/src/node/server/pluginContainer.ts')
SERVER = Path('packages/vite/src/node/server/index.ts')
TEST = Path('packages/vite/src/node/__tests__/server/watchChange-error-isolation.spec.js')

plugin = PLUGIN.read_text()

hook_anchor = '''    await Promise.all(parallelPromises)\n  }\n\n  async buildStart(_options?: InputOptions): Promise<void> {\n'''
hook_replacement = '''    await Promise.all(parallelPromises)\n  }\n\n  private async hookParallelWithErrorHandler<\n    H extends AsyncPluginHooks & ParallelPluginHooks,\n  >(\n    hookName: H,\n    context: (plugin: Plugin) => ThisType<FunctionPluginHooks[H]>,\n    args: (plugin: Plugin) => Parameters<FunctionPluginHooks[H]>,\n    onError: (error: Parameters<Logger['error']>[0]) => void,\n    condition?: (plugin: Plugin) => boolean | undefined,\n  ): Promise<void> {\n    const parallelPromises: Promise<void>[] = []\n    const runHook = async (plugin: Plugin) => {\n      const hook = plugin[hookName]!\n      const handler: Function = getHookHandler(hook)\n      try {\n        await handler.apply(context(plugin), args(plugin))\n      } catch (error) {\n        onError(error as Parameters<Logger['error']>[0])\n      }\n    }\n\n    for (const plugin of this.getSortedPlugins(hookName)) {\n      if (condition && !condition(plugin)) continue\n\n      const hook = plugin[hookName]\n      if ((hook as { sequential?: boolean }).sequential) {\n        await Promise.all(parallelPromises)\n        parallelPromises.length = 0\n        await runHook(plugin)\n      } else {\n        parallelPromises.push(runHook(plugin))\n      }\n    }\n    await Promise.all(parallelPromises)\n  }\n\n  async buildStart(_options?: InputOptions): Promise<void> {\n'''
if plugin.count(hook_anchor) != 1:
    raise SystemExit(f'expected one hook anchor, found {plugin.count(hook_anchor)}')
plugin = plugin.replace(hook_anchor, hook_replacement, 1)

watch_old = '''  async watchChange(\n    id: string,\n    change: { event: 'create' | 'update' | 'delete' },\n  ): Promise<void> {\n    const config = this.environment.getTopLevelConfig()\n    await this.hookParallel(\n      'watchChange',\n      (plugin) => this._getPluginContext(plugin),\n      () => [id, change],\n      (plugin) =>\n        this.environment.name === 'client' ||\n        config.server.perEnvironmentWatchChangeDuringDev ||\n        plugin.perEnvironmentWatchChangeDuringDev,\n    )\n  }\n'''
watch_new = '''  private shouldRunWatchChange(plugin: Plugin): boolean {\n    const config = this.environment.getTopLevelConfig()\n    return (\n      this.environment.name === 'client' ||\n      config.server.perEnvironmentWatchChangeDuringDev ||\n      plugin.perEnvironmentWatchChangeDuringDev === true\n    )\n  }\n\n  async watchChange(\n    id: string,\n    change: { event: 'create' | 'update' | 'delete' },\n  ): Promise<void> {\n    await this.hookParallel(\n      'watchChange',\n      (plugin) => this._getPluginContext(plugin),\n      () => [id, change],\n      (plugin) => this.shouldRunWatchChange(plugin),\n    )\n  }\n\n  /** @internal */\n  async watchChangeWithErrorHandler(\n    id: string,\n    change: { event: 'create' | 'update' | 'delete' },\n    onError: (error: Parameters<Logger['error']>[0]) => void,\n  ): Promise<void> {\n    await this.hookParallelWithErrorHandler(\n      'watchChange',\n      (plugin) => this._getPluginContext(plugin),\n      () => [id, change],\n      onError,\n      (plugin) => this.shouldRunWatchChange(plugin),\n    )\n  }\n'''
if plugin.count(watch_old) != 1:
    raise SystemExit(f'expected one watchChange block, found {plugin.count(watch_old)}')
plugin = plugin.replace(watch_old, watch_new, 1)
PLUGIN.write_text(plugin)

server = SERVER.read_text()
add_unlink_old = '''  const onFileAddUnlink = async (file: string, isUnlink: boolean) => {\n    file = normalizePath(file)\n    reloadOnTsconfigChange(server, file)\n\n    await Promise.all(\n      Object.values(server.environments).map((environment) =>\n        environment.pluginContainer.watchChange(file, {\n          event: isUnlink ? 'delete' : 'create',\n        }),\n      ),\n    )\n'''
add_unlink_new = '''  const notifyWatchChange = async (\n    file: string,\n    event: 'create' | 'update' | 'delete',\n  ) => {\n    const results = await Promise.allSettled(\n      Object.values(server.environments).map((environment) =>\n        environment.pluginContainer.watchChangeWithErrorHandler(\n          file,\n          { event },\n          (error) => server.config.logger.error(error),\n        ),\n      ),\n    )\n    for (const result of results) {\n      if (result.status === 'rejected') {\n        server.config.logger.error(result.reason)\n      }\n    }\n  }\n\n  const onFileAddUnlink = async (file: string, isUnlink: boolean) => {\n    file = normalizePath(file)\n    reloadOnTsconfigChange(server, file)\n\n    await notifyWatchChange(file, isUnlink ? 'delete' : 'create')\n'''
if server.count(add_unlink_old) != 1:
    raise SystemExit(f'expected one add/unlink block, found {server.count(add_unlink_old)}')
server = server.replace(add_unlink_old, add_unlink_new, 1)

change_old = '''  const onFileChange = async (file: string) => {\n    file = normalizePath(file)\n    reloadOnTsconfigChange(server, file)\n\n    await Promise.all(\n      Object.values(server.environments).map((environment) =>\n        environment.pluginContainer.watchChange(file, { event: 'update' }),\n      ),\n    )\n'''
change_new = '''  const onFileChange = async (file: string) => {\n    file = normalizePath(file)\n    reloadOnTsconfigChange(server, file)\n\n    await notifyWatchChange(file, 'update')\n'''
if server.count(change_old) != 1:
    raise SystemExit(f'expected one change block, found {server.count(change_old)}')
server = server.replace(change_old, change_new, 1)
SERVER.write_text(server)

test = TEST.read_text()
extra = r'''

test('watchChange hook can await server.restart without self-deadlocking', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-watch-change-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const stateFile = path.join(root, 'state.txt')
  await writeProject(root, { 'state.txt': 'alpha\n' })

  const entered = promiseWithResolvers()
  const finished = promiseWithResolvers()
  let server
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'restart-in-watch-change',
        async watchChange(id) {
          if (path.resolve(id) !== stateFile) return
          entered.resolve()
          await server.restart()
          finished.resolve()
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  server.watcher.emit('change', stateFile)
  await withTimeout(entered.promise, 'watchChange hook was not reached')
  await withTimeout(finished.promise, 'watchChange restart self-deadlocked')
})

test('direct pluginContainer.watchChange remains fail-fast', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vite-watch-change-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const stateFile = path.join(root, 'state.txt')
  await writeProject(root, { 'state.txt': 'alpha\n' })
  const watchChangeError = new Error('direct watchChange rejection')

  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'direct-watch-change-rejection',
        watchChange(id) {
          if (path.resolve(id) === stateFile) throw watchChangeError
        },
      },
    ],
    server: { middlewareMode: true, ws: false },
  })
  onTestFinished(() => server.close())

  await expect(
    server.environments.client.pluginContainer.watchChange(stateFile, {
      event: 'update',
    }),
  ).rejects.toBe(watchChangeError)
})
'''
if "watchChange hook can await server.restart without self-deadlocking" in test:
    raise SystemExit('restart test already present')
TEST.write_text(test.rstrip() + '\n' + extra)
