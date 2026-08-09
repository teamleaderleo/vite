# Proposed fix direction

This is a design note, not an upstream-ready patch.

## Goal

A rejected plugin `watchChange` hook remains visible to the developer while Vite still performs the file-change work needed to prevent stale transforms.

## Minimal policy

Introduce one helper in `packages/vite/src/node/server/index.ts` that invokes each environment's `pluginContainer.watchChange` with `Promise.allSettled` and logs every rejection through the configured logger.

Illustrative code:

```ts
const notifyWatchChange = async (
  file: string,
  event: 'create' | 'delete' | 'update',
) => {
  const results = await Promise.allSettled(
    Object.values(server.environments).map((environment) =>
      environment.pluginContainer.watchChange(file, { event }),
    ),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      server.config.logger.error(result.reason)
    }
  }
}
```

Use the helper in both watcher handlers before Vite's public-file bookkeeping, graph invalidation, and HMR work:

```ts
await notifyWatchChange(file, 'update')

for (const environment of Object.values(server.environments)) {
  environment.moduleGraph.onFileChange(file)
}
await onHMRUpdate('update', file)
```

The `add` and `unlink` paths should use the same helper with `create` and `delete`.

## Why logging rather than rethrowing is plausible

The watcher listeners currently catch a rejected handler promise and send it to `server.config.logger.error`. The rejection does not reach a caller that can recover from it. Logging inside the isolated helper preserves the visible outcome while allowing the handler to continue.

## Questions to settle before a core patch

1. Should all environment failures be logged individually or wrapped in one `AggregateError`?
2. Should an error emitted by HMR be reported after the hook errors, before them, or as a combined error?
3. Does any plugin rely on a failed `watchChange` hook aborting HMR as an implicit safety mechanism?
4. For `unlink`, should graph deletion always run even when public-file bookkeeping throws?
5. Should the same isolation policy live in the plugin container so other callers receive it automatically, or remain local to watcher events?

## Regression coverage

Add assertions to the existing watcher error-handling tests that a rejecting hook still allows:

- `moduleGraph.onFileChange(file)` for `change`;
- `moduleGraph.onFileDelete(file)` for `unlink`;
- `handleHotUpdate` or `hotUpdate` to be reached;
- all rejecting environments to be reported.

The executable probe should then change its expectations for the rejection case:

```js
assert.equal(rejection.invalidatedAfterEvent, true)
assert.equal(rejection.refreshedValue, 'beta')
```

## Alternative: invalidate before hooks

Moving graph invalidation before `watchChange` would prevent stale cache entries, but a rejection would still suppress HMR. It also changes what graph state plugins observe during `watchChange`. Error isolation is the narrower candidate because it preserves the existing ordering while allowing Vite's core work to finish.
