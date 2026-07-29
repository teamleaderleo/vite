# Draft issue: `watchChange` rejection can skip module invalidation and HMR

> Internal draft in `teamleaderleo/vite`. Do not publish upstream until the runtime probe and fix are verified.

## Environment

- Vite revision: `8a245726944ed29225920d49be77c33c6e03afc8`
- Mode: development server, middleware mode is sufficient
- Plugin API involved: `watchChange`, `load`, `this.addWatchFile`
- Upstream contact: none

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

The complete executable reproduction is in `probe.mjs` beside this draft.

## Candidate actual result

Control case:

- module transform cache becomes `null` after the file event;
- the next transform reads `beta`.

Rejecting-hook case:

- plugin error is logged;
- module transform cache remains populated;
- the next transform still returns `alpha`;
- plugin HMR hooks are not reached.

## Expected result

A plugin hook error should remain visible, while Vite still performs the cache invalidation required to keep later requests correct. HMR processing should continue when it is safe to do so.

## Why this is useful

A plugin failure should not leave Vite's internal transform or SSR caches silently stale after the watcher has observed a real file change. Logging the plugin error is valuable; preserving an old successful transform as though no file change occurred is misleading and can persist until another invalidation or server restart.

## Candidate fix

Run environment `watchChange` hooks with error isolation, report every rejection, and continue into Vite's core invalidation and HMR path. Apply one shared policy to `change`, `add`, and `unlink` events.

## Acceptance checks

- Regression probe fails against the pinned revision and passes with the fix.
- A rejecting hook is still reported through the configured logger.
- Core invalidation occurs after `change`, `add`, and `unlink` events.
- HMR processing remains reachable after a hook rejection.
- Multiple environment or plugin failures are all reported predictably.
- An HMR failure is not hidden by an earlier hook failure.
- Existing watcher error-logging tests continue to pass.
- SSR and bundled-development behaviour are recorded separately.
