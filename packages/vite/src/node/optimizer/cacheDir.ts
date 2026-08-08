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
  restartPredecessor?: WeakRef<DepsCachePrefixState>
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
 * Link a replacement environment to the previous server generation. A
 * replacement may be transformed before the previous server closes, but Vite
 * does not initialize its dependency optimizer until the later listen phase.
 */
export function linkDepsCacheDirRestart(
  environment: DevEnvironment,
  previousEnvironment: DevEnvironment,
): void {
  const state = environmentStates.get(environment)
  const previousState = environmentStates.get(previousEnvironment)
  if (
    !state ||
    !previousState ||
    state === previousState ||
    !isSameFilePath(state.configuredPrefix, previousState.configuredPrefix)
  ) {
    return
  }

  state.restartPredecessor = new WeakRef(previousState)
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
 * Return the dependency-cache prefix used for path planning and storage.
 * During restart setup, a replacement whose predecessor owns the configured
 * stable prefix may plan paths against that prefix without recording a claim.
 * Normal restart ordering closes the predecessor before optimizer init, so a
 * later storage call records the now-free stable claim. Private predecessors
 * are not inherited because safe transfer would require server-adoption state.
 */
export function getDepsCachePrefix(environment: Environment): string {
  const config = environment.getTopLevelConfig()
  const state = environmentStates.get(environment as DevEnvironment)
  if (!state) return getConfiguredDepsCachePrefix(environment)
  if (state.claimedPrefix) return state.claimedPrefix

  const predecessor = state.restartPredecessor?.deref()
  if (
    predecessor?.claimedPrefix &&
    isSameFilePath(predecessor.claimedPrefix, predecessor.configuredPrefix)
  ) {
    return predecessor.claimedPrefix
  }

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

  const sessionId = (isolatedDepsCachePrefixId++).toString(36).padStart(8, '0')
  state.privatePrefix = state.claimedPrefix = normalizePath(
    path.resolve(
      state.configuredRoot,
      `_deps_session_${process.pid}_${Date.now().toString(36)}_${sessionId}`,
    ),
  )
  return state.claimedPrefix
}

/** Return an already-claimed or stable-restart-planned prefix without generic claiming. */
export function getDepsCachePrefixForRecognition(
  environment: Environment,
): string | undefined {
  const state = environmentStates.get(environment as DevEnvironment)
  if (!state) return getConfiguredDepsCachePrefix(environment)
  if (state.claimedPrefix) return state.claimedPrefix

  const predecessor = state.restartPredecessor?.deref()
  if (
    predecessor?.claimedPrefix &&
    isSameFilePath(predecessor.claimedPrefix, predecessor.configuredPrefix)
  ) {
    return predecessor.claimedPrefix
  }
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

  // A restart successor only borrows a stable predecessor path for pre-listen
  // planning. Clearing the claim makes its later optimizer init perform the
  // real ownership decision after shutdown has completed.
  state.claimedPrefix = undefined
  state.privatePrefix = undefined
  state.stableOwner = undefined
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
