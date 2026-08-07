import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ResolvedConfig } from '../config'
import type { Environment } from '../environment'
import type { DevEnvironment } from '../server/environment'
import { isSameFilePath, normalizePath } from '../utils'

type DepsCacheRootOwner = {
  cacheRoot: string
  config: WeakRef<ResolvedConfig>
}

type DepsCacheRootState = {
  configuredRoot: string
  claimedRoot?: string
  stableOwner?: DepsCacheRootOwner
  privateRoot?: string
  references: number
}

const configStates = new WeakMap<ResolvedConfig, DepsCacheRootState>()
const environmentStates = new WeakMap<DevEnvironment, DepsCacheRootState>()
const stableOwners: DepsCacheRootOwner[] = []
let isolatedDepsCacheRootId = 0

/**
 * Register a built-in dev optimizer as a cache-owner participant without
 * claiming a live cache path yet. Delaying the claim lets a normal server
 * restart construct its replacement while the old server is still alive,
 * then reuse the stable cache after the old environment closes.
 */
export function registerDepsCacheDir(environment: DevEnvironment): void {
  if (environmentStates.has(environment)) return

  const config = environment.getTopLevelConfig()
  let state = configStates.get(config)
  if (!state) {
    state = {
      configuredRoot: normalizePath(path.resolve(config.cacheDir)),
      references: 0,
    }
    configStates.set(config, state)
  }

  state.references++
  environmentStates.set(environment, state)
}

/**
 * Return the cache root for real optimizer storage. Registered live dev
 * servers claim lazily: the first server keeps the configured root, while an
 * overlapping server receives a private child root for its whole lifetime.
 * Other optimizer callers keep the configured cache behavior.
 */
export function getDepsCacheRoot(environment: Environment): string {
  const config = environment.getTopLevelConfig()
  const state = environmentStates.get(environment as DevEnvironment)
  if (!state) return normalizePath(path.resolve(config.cacheDir))
  if (state.claimedRoot) return state.claimedRoot

  const owner = findStableOwner(state.configuredRoot)
  if (!owner) {
    const reservation: DepsCacheRootOwner = {
      cacheRoot: state.configuredRoot,
      config: new WeakRef(config),
    }
    stableOwners.push(reservation)
    state.stableOwner = reservation
    state.claimedRoot = state.configuredRoot
    return state.claimedRoot
  }

  if (owner.config.deref() === config) {
    state.stableOwner = owner
    state.claimedRoot = state.configuredRoot
    return state.claimedRoot
  }

  state.privateRoot = state.claimedRoot = normalizePath(
    path.resolve(
      state.configuredRoot,
      `_deps_session_${process.pid}_${Date.now().toString(36)}_${isolatedDepsCacheRootId++}`,
    ),
  )
  return state.claimedRoot
}

/**
 * Return a root already claimed by a live dev optimizer without claiming one
 * merely because a generic path predicate ran. Unregistered optimizer callers
 * retain the configured-root behavior.
 */
export function getDepsCacheRootForRecognition(
  environment: Environment,
): string | undefined {
  const config = environment.getTopLevelConfig()
  const state = environmentStates.get(environment as DevEnvironment)
  return state
    ? state.claimedRoot
    : normalizePath(path.resolve(config.cacheDir))
}

export function getConfiguredDepsCacheRoot(environment: Environment): string {
  return normalizePath(path.resolve(environment.getTopLevelConfig().cacheDir))
}

/**
 * Release one dev environment's participation after its optimizer and pending
 * requests have settled. Server-level ownership remains until the last
 * registered optimizer environment closes.
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

  if (state.privateRoot) {
    try {
      await fsp.rm(state.privateRoot, { recursive: true, force: true })
    } catch {
      // Best effort. A locked cache file should not make environment.close() fail.
    }
  }
}

function findStableOwner(cacheRoot: string): DepsCacheRootOwner | undefined {
  for (let i = stableOwners.length - 1; i >= 0; i--) {
    const owner = stableOwners[i]
    if (!owner.config.deref()) {
      stableOwners.splice(i, 1)
      continue
    }
    if (isSameFilePath(owner.cacheRoot, cacheRoot)) return owner
  }
}
