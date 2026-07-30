import fs from 'node:fs'
import path from 'node:path'
import MagicString from 'magic-string'
import type {
  ExportSpecifier,
  ImportSpecifier,
  ParseError as EsModuleLexerParseError,
} from 'es-module-lexer'
import { init, parse as parseImports } from 'es-module-lexer'
import type { StaticImport } from 'mlly'
import { ESM_STATIC_IMPORT_RE, parseStaticImport } from 'mlly'
import type { PartialResolvedId, RollupError } from 'rolldown'
import { CLIENT_PUBLIC_PATH, FS_PREFIX } from '../constants'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import type { DevEnvironment } from '../server/environment'
import {
  handlePrunedModules,
  lexAcceptedHmrDeps,
  lexAcceptedHmrExports,
  normalizeHmrUrl,
} from '../server/hmr'
import type { EnvironmentModuleNode } from '../server/moduleGraph'
import {
  isDataUrl,
  isDefined,
  isExternalUrl,
  joinUrlSegments,
  removeTimestampQuery,
  stripBase,
  transformStableResult,
} from '../utils'
import { cleanUrl, unwrapId, withTrailingSlash, wrapId } from '../../shared/utils'
import {
  canSkipImportAnalysis,
  createParseErrorInfo,
  isExplicitImportRequired,
} from './importAnalysis'

interface ImportAnalysisSnapshot {
  importExpressions: Map<string, number>
  hasEnv: boolean
}

interface ImportAnalysisReconcileContext {
  _viteImportAnalysisSource?: string
  _addedImports: Set<string> | null
}

interface UrlPosition {
  url: string
  start: number
  end: number
}

/**
 * Preserve the output of normal import analysis, then reconcile graph and HMR
 * state after user post transforms without re-running import URL rewriting.
 *
 * This is intentionally narrower than the normal import-analysis plugin. A
 * post transform may add a browser-resolvable relative or absolute import. A
 * late import that still requires Vite rewriting fails with a focused error
 * instead of silently creating served-source and graph disagreement.
 */
export function importAnalysisReconcilePlugins(
  config: ResolvedConfig,
): Plugin[] {
  const { base } = config
  const clientPublicPath = path.posix.join(base, CLIENT_PUBLIC_PATH)
  const enablePartialAccept = config.experimental.hmrPartialAccept

  return [
    {
      name: 'vite:import-analysis-snapshot',

      applyToEnvironment(environment) {
        return (
          !environment.config.isBundled &&
          environment.config.consumer === 'client'
        )
      },

      transform(source, importer) {
        if (canSkipImportAnalysis(importer)) return null
        ;(this as unknown as ImportAnalysisReconcileContext)._viteImportAnalysisSource =
          source
        return null
      },
    },
    {
      name: 'vite:import-analysis-reconcile',

      applyToEnvironment(environment) {
        return (
          !environment.config.isBundled &&
          environment.config.consumer === 'client'
        )
      },

      transform: {
        order: 'post',
        async handler(source, importer) {
          if (canSkipImportAnalysis(importer)) return null

          const context = this as unknown as ImportAnalysisReconcileContext
          const analyzedSource = context._viteImportAnalysisSource
          if (analyzedSource == null || source === analyzedSource) return null

          const environment = this.environment as DevEnvironment
          const moduleGraph = environment.moduleGraph
          const importerModule = moduleGraph.getModuleById(importer)
          if (!importerModule) return null

          await init
          const analyzedSnapshot = createImportAnalysisSnapshot(analyzedSource)
          const analyzedImportExpressions = new Map(
            analyzedSnapshot.importExpressions,
          )
          let imports!: readonly ImportSpecifier[]
          let exports!: readonly ExportSpecifier[]
          try {
            ;[imports, exports] = parseImports(source)
          } catch (_error: unknown) {
            const error = _error as EsModuleLexerParseError
            const { message, showCodeFrame } = createParseErrorInfo(
              importer,
              source,
            )
            this.error(message, showCodeFrame ? error.idx : undefined)
          }

          let hasHMR = false
          let hasEnv = false
          let isSelfAccepting = false
          let isPartiallySelfAccepting = false
          let magicString: MagicString | undefined
          const str = () =>
            magicString || (magicString = new MagicString(source))

          const importedBindings = enablePartialAccept
            ? new Map<string, Set<string>>()
            : null
          const orderedImportedModules = new Array<
            EnvironmentModuleNode | undefined
          >(imports.length)
          const orderedAcceptedUrls = new Array<
            Set<UrlPosition> | undefined
          >(imports.length)
          const orderedAcceptedExports = new Array<
            Set<string> | undefined
          >(imports.length)

          const ensureGraphEntry = async (
            specifier: string,
            position: number,
            options: {
              isDynamic: boolean
              wasPresentBefore: boolean
              rewriteAcceptedUrl?: boolean
            },
          ): Promise<EnvironmentModuleNode | null> => {
            if (
              (isExternalUrl(specifier) && !specifier.startsWith('file://')) ||
              isDataUrl(specifier) ||
              specifier === clientPublicPath
            ) {
              return null
            }

            if (
              !options.rewriteAcceptedUrl &&
              !options.wasPresentBefore &&
              specifier[0] !== '.' &&
              specifier[0] !== '/'
            ) {
              this.error(
                `A post transform introduced the import ${JSON.stringify(
                  specifier,
                )} after Vite import analysis. Late graph reconciliation can ` +
                  `preserve browser-resolvable relative and absolute imports, ` +
                  `but this specifier still requires Vite URL rewriting. Move ` +
                  `the import to an earlier transform or return a browser-valid URL.`,
                position,
              )
            }

            const resolved = await this.resolve(specifier, importer).catch(
              (error) => {
                if (error instanceof Error) {
                  ;(error as RollupError).pos ??= position
                }
                throw error
              },
            )

            if (!resolved || resolved.meta?.['vite:alias']?.noResolved) {
              return this.error(
                `Failed to resolve late import ${JSON.stringify(
                  specifier,
                )} from ${importer}.`,
                position,
              )
            }

            let url = normalizeResolvedIdToUrl(
              environment,
              specifier,
              resolved,
            )

            if (
              !options.rewriteAcceptedUrl &&
              !options.wasPresentBefore &&
              !options.isDynamic &&
              isExplicitImportRequired(url) &&
              !specifier.includes('?')
            ) {
              this.error(
                `A post transform introduced the static import ${JSON.stringify(
                  specifier,
                )} after Vite import analysis. This import requires source ` +
                  `rewriting to become a JavaScript module and cannot be tracked ` +
                  `safely by the late graph-only reconciler.`,
                position,
              )
            }

            url = joinUrlSegments(base, url)
            const graphUrl = unwrapId(stripBase(url, base))
            return moduleGraph._ensureEntryFromUrl(
              graphUrl,
              canSkipImportAnalysis(graphUrl),
              resolved,
            )
          }

          await Promise.all(
            imports.map(async (importSpecifier, index) => {
              const {
                s: start,
                e: end,
                ss: expressionStart,
                se: expressionEnd,
                d: dynamicIndex,
              } = importSpecifier
              const rawUrl = source.slice(start, end)

              if (rawUrl === 'import.meta') {
                const prop = source.slice(end, end + 4)
                if (prop === '.hot') {
                  hasHMR = true
                  const endHot = end + 4 + (source[end + 4] === '?' ? 1 : 0)
                  if (source.slice(endHot, endHot + 7) === '.accept') {
                    if (
                      source.slice(endHot, endHot + 14) ===
                      '.acceptExports'
                    ) {
                      const acceptedExports = (orderedAcceptedExports[index] =
                        new Set<string>())
                      lexAcceptedHmrExports(
                        source,
                        source.indexOf('(', endHot + 14) + 1,
                        acceptedExports,
                      )
                      isPartiallySelfAccepting = true
                    } else {
                      const acceptedUrls = (orderedAcceptedUrls[index] =
                        new Set<UrlPosition>())
                      if (
                        lexAcceptedHmrDeps(
                          source,
                          source.indexOf('(', endHot + 7) + 1,
                          acceptedUrls,
                        )
                      ) {
                        isSelfAccepting = true
                      }
                    }
                  }
                } else if (prop === '.env') {
                  hasEnv = true
                }
                return
              }

              const expression = source.slice(expressionStart, expressionEnd)
              const wasPresentBefore = consumeImportExpression(
                analyzedImportExpressions,
                expression,
              )
              const specifier = importSpecifier.n
              const isDynamic = dynamicIndex > -1

              if (specifier === undefined) {
                if (!wasPresentBefore) {
                  this.error(
                    `A post transform introduced a dynamic import expression ` +
                      `that Vite cannot reconcile after normal import analysis. ` +
                      `Move it to an earlier transform or return a literal ` +
                      `browser-valid URL.`,
                    start,
                  )
                }
                return
              }

              const importedModule = await ensureGraphEntry(specifier, start, {
                isDynamic,
                wasPresentBefore,
              })
              if (!importedModule) return

              orderedImportedModules[index] = importedModule
              if (enablePartialAccept && importedBindings) {
                extractImportedBindings(
                  importedModule.id || importedModule.url,
                  source,
                  importSpecifier,
                  importedBindings,
                )
              }
            }),
          )

          if (hasEnv && !analyzedSnapshot.hasEnv) {
            this.error(
              `A post transform introduced import.meta.env after normal import ` +
                `analysis. Late graph reconciliation does not own environment ` +
                `injection; move this usage to an earlier transform.`,
            )
          }

          const importedModules = new Set(
            orderedImportedModules.filter(isDefined),
          )
          const staticImportedUrls = new Set(
            [...importedModules].map((module) =>
              removeTimestampQuery(module.url),
            ),
          )

          const addedImports = context._addedImports
          if (addedImports) {
            for (const id of addedImports) {
              const resolved = await this.resolve(id, importer)
              if (!resolved) continue
              let url = normalizeResolvedIdToUrl(environment, id, resolved)
              url = joinUrlSegments(base, url)
              const graphUrl = unwrapId(stripBase(url, base))
              importedModules.add(
                await moduleGraph._ensureEntryFromUrl(
                  graphUrl,
                  canSkipImportAnalysis(graphUrl),
                  resolved,
                ),
              )
            }
          }

          const acceptedUrls = mergeAcceptedUrls(orderedAcceptedUrls)
          const acceptedExports = mergeAcceptedUrls(orderedAcceptedExports)
          const acceptedModules = new Set<EnvironmentModuleNode>()
          for (const { url, start, end } of acceptedUrls) {
            const acceptedModule = await ensureGraphEntry(url, start, {
              isDynamic: false,
              wasPresentBefore: true,
              rewriteAcceptedUrl: true,
            })
            if (!acceptedModule) continue
            acceptedModules.add(acceptedModule)
            str().overwrite(
              start,
              end,
              JSON.stringify(normalizeHmrUrl(acceptedModule.url)),
              { contentOnly: true },
            )
          }

          if (
            !isSelfAccepting &&
            isPartiallySelfAccepting &&
            acceptedExports.size >= exports.length &&
            exports.every((entry) => acceptedExports.has(entry.n))
          ) {
            isSelfAccepting = true
          }

          if (
            hasHMR &&
            !source.includes('import.meta.hot = __vite__createHotContext(')
          ) {
            str().prepend(
              `import { createHotContext as __vite__createHotContext } from "${clientPublicPath}";` +
                `import.meta.hot = __vite__createHotContext(${JSON.stringify(
                  normalizeHmrUrl(importerModule.url),
                )});`,
            )
          }

          const prunedImports = await moduleGraph.updateModuleInfo(
            importerModule,
            importedModules,
            importedBindings,
            acceptedModules,
            isPartiallySelfAccepting ? acceptedExports : null,
            isSelfAccepting,
            staticImportedUrls,
          )
          if (prunedImports) {
            handlePrunedModules(prunedImports, environment)
          }

          return magicString
            ? transformStableResult(magicString, importer, config)
            : null
        },
      },
    },
  ]
}

function createImportAnalysisSnapshot(source: string): ImportAnalysisSnapshot {
  const [imports] = parseImports(source)
  const importExpressions = new Map<string, number>()
  let hasEnv = false

  for (const importSpecifier of imports) {
    const rawUrl = source.slice(importSpecifier.s, importSpecifier.e)
    if (rawUrl === 'import.meta') {
      if (source.slice(importSpecifier.e, importSpecifier.e + 4) === '.env') {
        hasEnv = true
      }
      continue
    }

    const expression = source.slice(importSpecifier.ss, importSpecifier.se)
    importExpressions.set(
      expression,
      (importExpressions.get(expression) ?? 0) + 1,
    )
  }

  return { importExpressions, hasEnv }
}

function consumeImportExpression(
  importExpressions: Map<string, number>,
  expression: string,
): boolean {
  const count = importExpressions.get(expression) ?? 0
  if (count === 0) return false
  if (count === 1) {
    importExpressions.delete(expression)
  } else {
    importExpressions.set(expression, count - 1)
  }
  return true
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

  return url
}

function extractImportedBindings(
  id: string,
  source: string,
  importSpecifier: ImportSpecifier,
  importedBindings: Map<string, Set<string>>,
): void {
  let bindings = importedBindings.get(id)
  if (!bindings) {
    bindings = new Set<string>()
    importedBindings.set(id, bindings)
  }

  const isDynamic = importSpecifier.d > -1
  const isMeta = importSpecifier.d === -2
  if (isDynamic || isMeta) {
    bindings.add('*')
    return
  }

  const expression = source.slice(importSpecifier.ss, importSpecifier.se)
  ESM_STATIC_IMPORT_RE.lastIndex = 0
  const match = ESM_STATIC_IMPORT_RE.exec(expression)
  if (!match) return

  const staticImport: StaticImport = {
    type: 'static',
    code: match[0],
    start: match.index,
    end: match.index + match[0].length,
    imports: match.groups!.imports,
    specifier: match.groups!.specifier,
  }
  const parsed = parseStaticImport(staticImport)
  if (parsed.namespacedImport) bindings.add('*')
  if (parsed.defaultImport) bindings.add('default')
  if (parsed.namedImports) {
    for (const name of Object.keys(parsed.namedImports)) {
      bindings.add(name)
    }
  }
}

function mergeAcceptedUrls<T>(
  orderedUrls: Array<Set<T> | undefined>,
): Set<T> {
  const acceptedUrls = new Set<T>()
  for (const urls of orderedUrls) {
    if (!urls) continue
    for (const url of urls) acceptedUrls.add(url)
  }
  return acceptedUrls
}
