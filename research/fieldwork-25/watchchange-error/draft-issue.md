# Draft issue: `watchChange` rejection can skip module invalidation and HMR

> Internal draft in `teamleaderleo/vite`. Do not publish upstream until the runtime probe and fix are independently reviewed.

## Environment

- Vite revision: `8a245726944ed29225920d49be77c33c6e03afc8`
- Mode: development server; middleware mode is sufficient
- Plugin API involved: `watchChange`, `load`, `this.addWatchFile`
- Upstream contact: none

## Prior art and remaining gap

Vite PR `vitejs/vite#22188` (`fix(dev): handle errors in watchChange hook`) merged in April 2026. It added watcher-listener catches for `change`, `add`, and `unlink`, plus tests that require a rejected `watchChange` hook to reach the configured logger.

That fix prevents dropped or unhandled watcher promises. It does not isolate the hook failure from the rest of the file-event transaction. The current listener logs the rejection only after the event handler has already exited, so Vite-owned invalidation and HMR remain skipped.

This report is therefore a follow-up correctness gap in the merged error-handling path, not a duplicate claim that `watchChange` errors are unhandled.

## Description

When any environment's plugin `watchChange` hook rejects during a file event, the watcher handler exits before Vite runs its own module-graph invalidation and HMR processing.

The current `change` path is effectively:

1. await each environment's `pluginContainer.watchChange(...)`;
2. invalidate each environment's module graph;
3. process HMR.

The watcher listener catches and logs a rejection from step 1, so steps 2 and 3 are skipped.

## Reproduction

Use a plugin that resolves a virtual module, reads a text file in `load`, and registers that text file with `this.addWatchFile`. Transform the virtual module while the text file contains `alpha`, then rewrite the file to `beta` and emit a file-change event.

Run once with a successful `watchChange` hook and once with a hook that throws for the text file.

The complete executable reproduction is in `probe.mjs` beside this draft. An in-tree regression test is also included in the research branch.

## Actual result

Control case:

- module transform cache becomes `null` after the file event;
- the next transform reads `beta`.

Rejecting-hook case:

- plugin error is logged;
- module transform cache remains populated;
- the next transform still returns `alpha`;
- plugin HMR hooks are not reached.

The in-tree reproduction passed across Node 20, 22, 24, and 26 on Ubuntu and Node 24 on macOS and Windows at the pinned revision.

## Expected result

A plugin hook error should remain visible, while Vite still performs the cache invalidation required to keep later requests correct. HMR processing should continue when it is safe to do so.

## Why this is useful

A plugin failure should not leave Vite's internal transform or SSR caches stale after the watcher has observed a real file change. Logging the plugin error is useful; preserving an old successful transform as though no file change occurred is misleading and can persist until another invalidation or server restart.

## Candidate fix boundary

Isolate environment-level `watchChange` rejections at the server file-event boundary, report each rejection through the configured logger, and then continue into Vite-owned invalidation and HMR.

Avoid changing the generic `hookParallel` contract in the first patch. That helper is shared by other plugin hooks and has sequential-hook ordering semantics. The narrow problem is that a file event must still maintain Vite's own cache after a plugin notification fails.

Apply one shared notification helper to `change`, `add`, and `unlink` so their behavior cannot drift.

## Acceptance checks

- Regression test fails against the pinned revision and passes with the fix.
- A rejecting hook is still reported through the configured logger.
- Core invalidation occurs after `change`, `add`, and `unlink` events.
- HMR processing remains reachable after a hook rejection.
- Environment-level failures are reported predictably.
- An HMR failure is not hidden by an earlier hook failure.
- Existing watcher error-logging tests from `vitejs/vite#22188` continue to pass.
- SSR and bundled-development behavior are recorded separately.
