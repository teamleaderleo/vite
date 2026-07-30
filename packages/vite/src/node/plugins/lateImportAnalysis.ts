import fs from 'node:fs'
import path from 'node:path'
import type {
  ImportSpecifier,
  ParseError as EsModuleLexerParseError,
} from 'es-module-lexer'
import { init, parse as parseImports } from 'es-module-lexer'
import MagicString from 'magic-string'
import type { PartialResolvedId } from 'rolldown'
import { CLIENT_PUBLIC_PATH, FS_PREFIX, SPECIAL_QUERY_RE } from '../constants'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import type { DevEnvironment } from '../server/environment'
import type { EnvironmentModuleNode } from '../server/moduleGraph'
import {
  handlePrunedModules,
  lexAcceptedHmrDeps,
  normalizeHmrUrl,
} from '../server/hmr'
import {
  isCSSRequest,
  isDataUrl,
  isExternalUrl,
  normalizePath,
  transformStableResult,
} from '../utils'
import {
  cleanUrl,
  unwrapId,
  withTrailingSlash,
  wrapId,
} from '../../shared/utils'
import {
  canSkipImportAnalysis,
  createParseErrorInfo,
  isExplicitImportRequired,
} from './importAnalysis'

interface UrlPosition {
  url: string
  start: number
  end: number
}

interface LateImportState {
  importedModules: Set<EnvironmentModuleNode>
  acceptedModules: Set<EnvironmentModuleNode>
  staticImportedUrls: Set<string>
}

/**
 * Prototype final-source reconciliation plugins.
 *
 * The preserve plugin carries the previous final-source import overlay through
 * the ordinary import-analysis pass so an unchanged late dependency is not
 * transiently pruned. The final plugin then replaces that overlay from the
 * current final source without rerunning ordinary URL rewriting.
 */
export function lateImportAnalysisPlugins(): Plugin[] {
  let config: ResolvedConfig
  let clientPublicPath: string
  const stateByEnvironment = new WeakMap<
    DevEnvironment,
    Map<string, LateImportState>
  >()

  const getEnvironmentState = (environment: DevEnvironment) => {
    let state = stateByEnvironment.get(environment)
    if (!state) {
      state = new Map()
      stateByEnvironment.set(environment, state)
    }
    return state
  }

  const preservePlugin: Plugin = {
    name: 'vite:late-import-analysis-preserve',

    applyToEnvironment(environment) {
      return !environment.config.isBundled
    },

    transform(_source, importer) {
      const environment = this.environment as DevEnvironment
      const previous = getEnvironmentState(environment).get(importer)
      if (!previous) return null

      for (const dependency of previous.importedModules) {
        if (dependency.file) this.addWatchFile(dependency.file)
      }
      return null
    },
  }

  const reconcilePlugin: Plugin = {
    name: 'vite:late-import-analysis',

    configResolved(resolvedConfig) {
      config = resolvedConfig
      clientPublicPath = path.posix.join(config.base, CLIENT_PUBLIC_PATH)
    },

    applyToEnvironment(environment) {
      return !environment.config.isBundled
    },

    transform: {
      order: 'post',
      async handler(source, importer) {
        if (canSkipImportAnalysis(importer)) return null

        await init
        let imports: readonly ImportSpecifier[]
        try {
          ;[imports] = parseImports(source)
        } catch (_error: unknown) {
          const error = _error as EsModuleLexerParseError
          const { message, showCodeFrame } = createParseErrorInfo(
            importer,
            source,
          )
          this.error(message, showCodeFrame ? error.idx : undefined)
        }

        const environment = this.environment as DevEnvironment
        const moduleGraph = environment.moduleGraph
        const importerModule = moduleGraph.getModuleById(importer)
        if (!importerModule) return null

        const environmentState = getEnvironmentState(environment)
        const previous = environmentState.get(importer)

        const baseImportedModules = new Set(importerModule.importedModules)
        const baseAcceptedModules = new Set(importerModule.acceptedHmrDeps)
        const baseStaticImportedUrls = new Set(
          importerModule.staticImportedUrls ?? [],
        )
        if (previous) {
          for (const dependency of previous.importedModules) {
            baseImportedModules.delete(dependency)
          }
          for (const dependency of previous.acceptedModules) {
            baseAcceptedModules.delete(dependency)
          }
          for (const url of previous.staticImportedUrls) {
            baseStaticImportedUrls.delete(url)
          }
        }

        const finalImportedModules = new Set<EnvironmentModuleNode>()
        const finalAcceptedModules = new Set<EnvironmentModuleNode>()
        const finalStaticImportedUrls = new Set<string>()
        const acceptedUrls = new Set<UrlPosition>()
        let isSelfAccepting = importerModule.isSelfAccepting
        let hasHMR = false
        let output: MagicString | undefined
        const edit = () => output || (output = new MagicString(source))

        const resolveModule = async (url: string) => {
          const resolved = await this.resolve(url, importer)
          if (!resolved || isExternalUrl(resolved.id)) return null

          const normalizedUrl = normalizeResolvedIdToUrl(
            environment,
            url,
            resolved,
          )
          return moduleGraph._ensureEntryFromUrl(
            unwrapId(normalizedUrl),
            false,
            resolved,
          )
        }

        for (const importSpecifier of imports) {
          const {
            s: start,
            e: end,
            d: dynamicIndex,
          } = importSpecifier
          const rawUrl = source.slice(start, end)

          if (rawUrl === 'import.meta') {
            const prop = source.slice(end, end + 4)
            if (prop !== '.hot') continue

            hasHMR = true
            const endHot = end + 4 + (source[end + 4] === '?' ? 1 : 0)
            if (source.slice(endHot, endHot + 7) !== '.accept') continue

            const acceptStart = source.indexOf('(', endHot + 7)
            if (acceptStart < 0) continue
            if (
              lexAcceptedHmrDeps(source, acceptStart + 1, acceptedUrls)
            ) {
              isSelfAccepting = true
            }
            continue
          }

          const specifier = importSpecifier.n
          if (!specifier) continue
          if (specifier === clientPublicPath) continue
          if (isExternalUrl(specifier) || isDataUrl(specifier)) continue

          const isDynamicImport = dynamicIndex > -1
          if (isDynamicImport && isExplicitImportRequired(specifier)) {
            // Preserve current first-party behavior where a post transform
            // intentionally introduces a raw dynamic import after rewriting.
            continue
          }

          const dependency = await resolveModule(specifier)
          if (!dependency) continue
          finalImportedModules.add(dependency)
          if (!isDynamicImport) finalStaticImportedUrls.add(dependency.url)
        }

        for (const accepted of acceptedUrls) {
          const dependency = await resolveModule(accepted.url)
          if (!dependency) continue
          finalAcceptedModules.add(dependency)
          edit().overwrite(
            accepted.start,
            accepted.end,
            JSON.stringify(normalizeHmrUrl(dependency.url)),
            { contentOnly: true },
          )
        }

        if (
          hasHMR &&
          environment.config.consumer === 'client' &&
          !source.includes('__vite__createHotContext')
        ) {
          edit().prepend(
            `import { createHotContext as __vite__createHotContext } from ${JSON.stringify(
              clientPublicPath,
            )};` +
              `import.meta.hot = __vite__createHotContext(${JSON.stringify(
                normalizeHmrUrl(importerModule.url),
              )});`,
          )
        }

        const importedModules = new Set([
          ...baseImportedModules,
          ...finalImportedModules,
        ])
        const acceptedModules = new Set([
          ...baseAcceptedModules,
          ...finalAcceptedModules,
        ])
        const staticImportedUrls = new Set([
          ...baseStaticImportedUrls,
          ...finalStaticImportedUrls,
        ])

        if (!isCSSRequest(importer) || SPECIAL_QUERY_RE.test(importer)) {
          const prunedImports = await moduleGraph.updateModuleInfo(
            importerModule,
            importedModules,
            importerModule.importedBindings,
            acceptedModules,
            importerModule.acceptedHmrExports,
            isSelfAccepting,
            staticImportedUrls,
          )
          if (prunedImports) handlePrunedModules(prunedImports, environment)
        }

        environmentState.set(importer, {
          importedModules: new Set(
            [...finalImportedModules].filter(
              (dependency) => !baseImportedModules.has(dependency),
            ),
          ),
          acceptedModules: new Set(
            [...finalAcceptedModules].filter(
              (dependency) => !baseAcceptedModules.has(dependency),
            ),
          ),
          staticImportedUrls: new Set(
            [...finalStaticImportedUrls].filter(
              (url) => !baseStaticImportedUrls.has(url),
            ),
          ),
        })

        return output ? transformStableResult(output, importer, config) : null
      },
    },
  }

  return [preservePlugin, reconcilePlugin]
}

function normalizeResolvedIdToUrl(
  environment: DevEnvironment,
  url: string,
  resolved: PartialResolvedId,
): string {
  const root = environment.config.root
  const depsOptimizer = environment.depsOptimizer

  if (resolved.id.startsWith(withTrailingSlash(root))) {
    url = resolved.id.slice(root.length)
  } else if (
    depsOptimizer?.isOptimizedDepFile(resolved.id) ||
    (resolved.id !== '/@react-refresh' &&
      path.isAbsolute(resolved.id) &&
      fs.existsSync(cleanUrl(resolved.id)))
  ) {
    url = path.posix.join(FS_PREFIX, resolved.id)
  } else {
    url = resolved.id
  }

  if (url[0] !== '.' && url[0] !== '/') {
    url = wrapId(resolved.id)
  }

  return normalizePath(url)
}
