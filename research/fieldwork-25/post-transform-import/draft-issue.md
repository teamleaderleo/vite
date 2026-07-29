# Draft issue: post-order transforms can bypass dev import and HMR graph analysis

## Summary

A plugin transform with hook-level `order: 'post'` can run after Vite's internal `vite:import-analysis` transform. When that plugin injects an import or `import.meta.hot.accept()` call, the browser receives the added code, while Vite's development module graph may omit the dependency and acceptance edge.

Production build still includes the dependency because the bundler parses the final transformed output.

## Reproduction

Use the test in:

```text
packages/vite/src/node/__tests__/server/post-transform-import-graph.spec.js
```

The fixture starts with a `main.js` that has no imports. A plugin injects:

```js
import { dep } from './dep.js'
console.log(dep)
if (import.meta.hot) import.meta.hot.accept('./dep.js', () => {})
```

The same transform is tested in normal order and with `order: 'post'`.

## Observed/expected result

Normal order:

- served code includes the import;
- module graph contains the dependency;
- module graph contains the accepted HMR dependency;
- Vite injects the HMR context;
- updating the dependency produces an `update` payload.

Post order:

- served code includes the import;
- module graph omits the dependency;
- module graph omits the accepted HMR dependency;
- HMR context setup is absent;
- updating the dependency produces a `full-reload` payload;
- production build includes the dependency.

## Impact

Plugins that intentionally use post-order transforms to finalize generated modules can create dev/build disagreement. The browser can execute an import that Vite does not know belongs to the importer, and the plugin's intended HMR boundary can be ignored. This can produce unnecessary full reloads and may create stale behaviour in more complex virtual-module graphs.

## Possible directions

- reserve a final import-analysis pass after post transforms;
- restrict post-order transforms from introducing import/HMR syntax;
- detect code changes after import analysis and re-run only graph/HMR extraction;
- introduce a narrower plugin contract for transforms that must run after ordinary analysis.

A warning alone would leave the runtime mismatch intact.

## Version

Pinned revision: `8a245726944ed29225920d49be77c33c6e03afc8`.
