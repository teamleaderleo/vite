import type { DevEnvironment } from '../server/environment'

export interface LateImportState {
  importedIds: Set<string>
  importedUrls: Set<string>
  acceptedUrls: Set<string>
  staticImportedUrls: Set<string>
}

const stateByEnvironment = new WeakMap<
  DevEnvironment,
  Map<string, LateImportState>
>()

function getEnvironmentState(environment: DevEnvironment) {
  let state = stateByEnvironment.get(environment)
  if (!state) {
    state = new Map()
    stateByEnvironment.set(environment, state)
  }
  return state
}

export function getLateImportState(
  environment: DevEnvironment,
  importer: string,
): LateImportState | undefined {
  return getEnvironmentState(environment).get(importer)
}

export function setLateImportState(
  environment: DevEnvironment,
  importer: string,
  state: LateImportState,
): void {
  const environmentState = getEnvironmentState(environment)
  if (
    state.importedIds.size === 0 &&
    state.importedUrls.size === 0 &&
    state.acceptedUrls.size === 0 &&
    state.staticImportedUrls.size === 0
  ) {
    environmentState.delete(importer)
    return
  }
  environmentState.set(importer, state)
}
