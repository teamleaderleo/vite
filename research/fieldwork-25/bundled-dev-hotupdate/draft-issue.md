# Draft upstream issue — bundled dev skips plugin `hotUpdate` custom handling

## Suggested title

Experimental bundled dev skips plugin `hotUpdate`, leaving plugin-managed browser state stale

## Description

In experimental bundled development, filesystem changes reach plugin `watchChange` hooks, but Vite returns from HMR handling before plugin `hotUpdate` and legacy `handleHotUpdate` hooks run.

This can leave browser state stale for plugins that deliberately own updates to external or virtual state through custom HMR events.

## Reproduction

Pinned revision: `8a245726944ed29225920d49be77c33c6e03afc8`.

The attached playground fixture defines a virtual module whose initial value is read from `plugin-state.txt`. The text file is intentionally not inserted into the bundler graph. The plugin handles it as external state:

- `watchChange` sends a `fieldwork:watch-seen` custom event;
- `hotUpdate` reads the new value and sends a `fieldwork:state` custom event;
- the browser updates visible text when `fieldwork:state` arrives.

Run the fixture through Vite's ordinary serve suite and bundled-development serve suite.

## Observed result

Ordinary dev:

1. the page initially displays `alpha`;
2. the backing file changes to `beta`;
3. the browser receives the watcher marker;
4. the browser receives the custom state update;
5. visible state becomes `beta` without reload.

Bundled dev:

1. the page initially displays `alpha`;
2. the backing file changes to `beta`;
3. the browser receives the watcher marker, proving Vite observed the event;
4. the plugin `hotUpdate` custom event never arrives;
5. visible state remains stale at `alpha`.

## Expected result

Bundled development should either:

- deliver plugin `hotUpdate`/`handleHotUpdate` handling with semantics compatible with the bundled HMR pipeline; or
- reject or clearly diagnose plugins that rely on unsupported custom hot-update handling before serving the application.

Silently accepting the plugin while dropping its custom update path leaves application state incorrect.

## Notes

Bundled development is experimental and its plugin limitations are documented. This report is therefore a bounded compatibility gap with a browser-visible consequence, not a claim that the experimental mode promises complete plugin compatibility today.

No issue has been filed upstream from this draft.
