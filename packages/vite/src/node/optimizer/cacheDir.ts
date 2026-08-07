import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ResolvedConfig } from '../config'
import type { Environment } from '../environment'
import type { DevEnvironment } from '../server/environment'
import { isSameFilePath, normalizePath } from '../utils'

type DepsCachePrefixOwner = {
  configuredPrefix: string
  config: WeakRef<ResolvedConfig>
}

type DepsCachePrefixState = {
  configuredRoot: string
  configuredPrefix: string
  claimedPrefix?: string
  stableOwner?: DepsCachePrefixOwner
  privatePrefix?: string
  references: number
}

const configStates = new WeakMap<ResolvedConfig, DepsCachePrefixState>()
const environmentStates = new WeakMap<DevEnvironment, DepsCachePrefixState>()
const stableOwners: DepsCachePrefixOwner[] = []
let isolatedDepsCachePrefixId = 0

/**
 * Register a built-in dev optimizer without claiming its live cache path.
 * This keeps replacement environments lazy during a normal server restart.
 */
export function registerDepsCacheDir(environment: DevEnvironment): void {
  if (environmentStates.has(environment)) return

  const config = environment.getTopLevelConfig()
  let state = configStates.get(config)
  if (!state) {
    const configuredRoot = normalizePath(path.resolve(config.cacheDir))
    state = {
      configuredRoot,
      configuredPrefix: normalizePath(path.resolve(configuredRoot, 'deps')),
      references: 0,
    }
    configStates.set(config, state)
  }

  state.references++
  environmentStates.set(environment, state)
}

/**
 * Backward-compatible registration entry used by DevEnvironment. Registration
 * itself is lazy; the returned release function is called after environment
 * shutdown has settled optimizer work and pending requests.
 */
export function reserveDepsCacheDir(
  environment: DevEnvironment,
): () => Promise<void> {
  registerDepsCacheDir(environment)
  return () => releaseDepsCacheDir(environment)
}

/**
 * Return the live dependency-cache prefix for real optimizer storage. The
 * first live server keeps `<cacheDir>/deps`; a genuinely overlapping server
 * receives a sibling `_deps_session_*` prefix at the same directory depth.
 * Keeping the same depth preserves optimizer asset-relative rewrite behavior.
 */
export function getDepsCachePrefix(environment: Environment): string {
  const config = environment.getTopLevelConfig()
  const state = environmentStates.get(environment as DevEnvironment)
  if (!state) return getConfiguredDepsCachePrefix(environment)
  if (state.claimedPrefix) return state.claimedPrefix

  const owner = findStableOwner(state.configuredPrefix)
  if (!owner) {
    const reservation: DepsCachePrefixOwner = {
      configuredPrefix: state.configuredPrefix,
      config: new WeakRef(config),
    }
    stableOwners.push(reservation)
    state.stableOwner = reservation
    state.claimedPrefix = state.configuredPrefix
    return state.claimedPrefix
  }

  if (owner.config.deref() === config) {
    state.stableOwner = owner
    state.claimedPrefix = state.configuredPrefix
    return state.claimedPrefix
  }

  state.privatePrefix = state.claimedPrefix = normalizePath(
    path.resolve(
      state.configuredRoot,
      `_deps_session_${process.pid}_${Date.now().toString(36)}_${isolatedDepsCachePrefixId++}`,
    ),
  )
  return state.claimedPrefix
}

/** Return an already-claimed prefix without causing a generic path check to claim. */
export function getDepsCachePrefixForRecognition(
  environment: Environment,
): string | undefined {
  const state = environmentStates.get(environment as DevEnvironment)
  return state ? state.claimedPrefix : getConfiguredDepsCachePrefix(environment)
}

export function getConfiguredDepsCachePrefix(environment: Environment): string {
  return normalizePath(
    path.resolve(environment.getTopLevelConfig().cacheDir, 'deps'),
  )
}

/**
 * Release one optimizer environment. Server-level ownership remains until the
 * last registered optimizer environment closes.
 */
export async function releaseDepsCacheDir(
  environment: DevEnvironment,
): Promise<void> {
  const state = environmentStates.get(environment)
  if (!state) return
  environmentStates.delete(environment)

  state.references--
  if (state.references > 0) return

  const config = environment.getTopLevelConfig()
  if (configStates.get(config) === state) configStates.delete(config)

  if (state.stableOwner) {
    const index = stableOwners.indexOf(state.stableOwner)
    if (index !== -1) stableOwners.splice(index, 1)
  }

  if (state.privatePrefix) {
    const parent = path.dirname(state.privatePrefix)
    const basename = path.basename(state.privatePrefix)
    try {
      const entries = await fsp.readdir(parent)
      await Promise.allSettled(
        entries
          .filter(
            (entry) => entry === basename || entry.startsWith(`${basename}_`),
          )
          .map((entry) =>
            fsp.rm(path.resolve(parent, entry), { recursive: true, force: true }),
          ),
      )
    } catch {
      // Best effort. Locked cache files should not make environment.close() fail.
    }
  }
}

function findStableOwner(
  configuredPrefix: string,
): DepsCachePrefixOwner | undefined {
  for (let i = stableOwners.length - 1; i >= 0; i--) {
    const owner = stableOwners[i]
    if (!owner.config.deref()) {
      stableOwners.splice(i, 1)
      continue
    }
    if (isSameFilePath(owner.configuredPrefix, configuredPrefix)) return owner
  }
}
