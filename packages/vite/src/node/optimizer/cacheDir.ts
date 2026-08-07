import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ResolvedEnvironmentOptions } from '../config'
import type { DevEnvironment } from '../server/environment'
import { isSameFilePath } from '../utils'
import { getDepsCacheDir } from './index'

type DepsCacheDirOwner = {
  cacheDir: string
  environment: WeakRef<DevEnvironment>
}

const depsCacheDirOwners: DepsCacheDirOwner[] = []
let isolatedDepsCacheDirId = 0

/**
 * Keep concurrent dev environments in this process from publishing optimized
 * dependencies into the same live cache directory.
 *
 * The first environment keeps the configured cache directory so the normal
 * warm-cache path stays unchanged. An overlapping environment gets a temporary
 * cache root that is removed when the environment closes.
 */
export function reserveDepsCacheDir(
  environment: DevEnvironment,
): () => Promise<void> {
  const depsCacheDir = getDepsCacheDir(environment)
  const owner = findDepsCacheDirOwner(depsCacheDir)

  if (!owner) {
    const reservation: DepsCacheDirOwner = {
      cacheDir: depsCacheDir,
      environment: new WeakRef(environment),
    }
    depsCacheDirOwners.push(reservation)
    return createReleaseOwner(reservation, environment)
  }

  if (owner.environment.deref() === environment) {
    return createReleaseOwner(owner, environment)
  }

  const isolatedCacheDir = path.resolve(
    environment.config.cacheDir,
    `_deps_session_${process.pid}_${Date.now().toString(36)}_${isolatedDepsCacheDirId++}`,
  )
  ;(
    environment._options as ResolvedEnvironmentOptions & { cacheDir?: string }
  ).cacheDir = isolatedCacheDir

  return async () => {
    await fsp.rm(isolatedCacheDir, { recursive: true, force: true })
  }
}

function findDepsCacheDirOwner(cacheDir: string): DepsCacheDirOwner | undefined {
  for (let i = depsCacheDirOwners.length - 1; i >= 0; i--) {
    const owner = depsCacheDirOwners[i]
    if (!owner.environment.deref()) {
      depsCacheDirOwners.splice(i, 1)
      continue
    }
    if (isSameFilePath(owner.cacheDir, cacheDir)) {
      return owner
    }
  }
}

function createReleaseOwner(
  reservation: DepsCacheDirOwner,
  environment: DevEnvironment,
): () => Promise<void> {
  return async () => {
    if (reservation.environment.deref() !== environment) return
    const index = depsCacheDirOwners.indexOf(reservation)
    if (index !== -1) depsCacheDirOwners.splice(index, 1)
  }
}
