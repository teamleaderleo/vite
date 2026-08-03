from pathlib import Path

path = Path("packages/vite/src/node/server/pluginContainer.ts")
text = path.read_text()

helper_anchor = """    await Promise.all(parallelPromises)
  }

  async buildStart(_options?: InputOptions): Promise<void> {
"""
helper_replacement = """    await Promise.all(parallelPromises)
  }

  private async hookParallelAndCollectErrors<
    H extends AsyncPluginHooks & ParallelPluginHooks,
  >(
    hookName: H,
    context: (plugin: Plugin) => ThisType<FunctionPluginHooks[H]>,
    args: (plugin: Plugin) => Parameters<FunctionPluginHooks[H]>,
    condition?: (plugin: Plugin) => boolean | undefined,
  ): Promise<unknown[]> {
    const errors: Array<{ hookIndex: number; error: unknown }> = []
    const parallelPromises: Promise<void>[] = []
    let hookIndex = 0

    const runHook = async (plugin: Plugin, currentHookIndex: number) => {
      try {
        const hook = plugin[hookName]!
        const handler: Function = getHookHandler(hook)
        await handler.apply(context(plugin), args(plugin))
      } catch (error) {
        errors.push({ hookIndex: currentHookIndex, error })
      }
    }

    for (const plugin of this.getSortedPlugins(hookName)) {
      if (condition && !condition(plugin)) continue

      const currentHookIndex = hookIndex++
      const hook = plugin[hookName]!
      if ((hook as { sequential?: boolean }).sequential) {
        await Promise.all(parallelPromises)
        parallelPromises.length = 0
        await runHook(plugin, currentHookIndex)
      } else {
        parallelPromises.push(runHook(plugin, currentHookIndex))
      }
    }
    await Promise.all(parallelPromises)

    return errors
      .sort((left, right) => left.hookIndex - right.hookIndex)
      .map(({ error }) => error)
  }

  async buildStart(_options?: InputOptions): Promise<void> {
"""

close_block = """    const config = this.environment.getTopLevelConfig()
    let buildEndFailed = false
    let buildEndError: unknown
    try {
      await this.hookParallel(
        'buildEnd',
        (plugin) => this._getPluginContext(plugin),
        () => [],
        (plugin) =>
          this.environment.name === 'client' ||
          config.server.perEnvironmentStartEndDuringDev ||
          plugin.perEnvironmentStartEndDuringDev,
      )
    } catch (error) {
      buildEndFailed = true
      buildEndError = error
    }

    try {
      await this.hookParallel(
        'closeBundle',
        (plugin) => this._getPluginContext(plugin),
        () => [],
      )
    } catch (closeBundleError) {
      if (buildEndFailed) {
        throw new AggregateError(
          [buildEndError, closeBundleError],
          'buildEnd and closeBundle hooks failed',
        )
      }
      throw closeBundleError
    }

    if (buildEndFailed) {
      throw buildEndError
    }
"""
close_replacement = """    const config = this.environment.getTopLevelConfig()
    const errors = [
      ...(await this.hookParallelAndCollectErrors(
        'buildEnd',
        (plugin) => this._getPluginContext(plugin),
        () => [],
        (plugin) =>
          this.environment.name === 'client' ||
          config.server.perEnvironmentStartEndDuringDev ||
          plugin.perEnvironmentStartEndDuringDev,
      )),
      ...(await this.hookParallelAndCollectErrors(
        'closeBundle',
        (plugin) => this._getPluginContext(plugin),
        () => [],
      )),
    ]

    if (errors.length === 1) {
      throw errors[0]
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'buildEnd or closeBundle hooks failed')
    }
"""

if text.count(helper_anchor) != 1:
    raise SystemExit(f"expected one helper anchor, found {text.count(helper_anchor)}")
text = text.replace(helper_anchor, helper_replacement, 1)

if text.count(close_block) != 1:
    raise SystemExit(f"expected one close block, found {text.count(close_block)}")
text = text.replace(close_block, close_replacement, 1)

path.write_text(text)
print("FIELDWORK_VITE_CLOSE_REPAIR=barrier-safe-attempt-all")
