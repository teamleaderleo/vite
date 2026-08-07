import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ResolvedEnvironmentOptions } from '../config'
import type { DevEnvironment } from '../server/environment'
import { getDepsCacheDir } from './index'

const depsCacheDirOwners = new Map<string, WeakRef<DevEnvironment>>()
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
  const owner = depsCacheDirOwners.get(depsCacheDir)?.deref()

  if (!owner || owner === environment) {
    depsCacheDirOwners.set(depsCacheDir, new WeakRef(environment))
    return async () => {
      if (depsCacheDirOwners.get(depsCacheDir)?.deref() === environment) {
        depsCacheDirOwners.delete(depsCacheDir)
      }
    }
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
