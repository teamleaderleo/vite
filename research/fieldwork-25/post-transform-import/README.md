# Post-transform import graph research

Target Vite revision: `8a245726944ed29225920d49be77c33c6e03afc8`.

Fieldwork lane: `teamleaderleo/fieldwork#25`.

Upstream contact: none.

## Question

What happens when a plugin uses hook-level `transform: { order: 'post' }` and injects an import plus an HMR accept call after Vite's normal import-analysis transform has already run?

## Reproduction

The in-tree Vitest case is:

```text
packages/vite/src/node/__tests__/server/post-transform-import-graph.spec.js
```

It compares a normal transform with an otherwise identical post-order transform.

The test checks:

- whether the served dev output contains the injected import;
- whether Vite's dev module graph records the dependency;
- whether Vite records the HMR accept boundary;
- whether Vite injected its HMR context setup;
- whether changing the dependency produces an HMR update or a full reload decision;
- whether the production build includes the dependency.

## Expected candidate behaviour

Normal transform:

- import analysis sees the injected code;
- the dependency and accept boundary are recorded;
- the HMR context is injected;
- dependency change produces an update payload;
- production build includes the dependency.

Post-order transform:

- served dev output still contains the injected import;
- the dependency and accept boundary are absent from the dev graph;
- HMR context setup is absent because import analysis already ran;
- the same dependency change falls back to full reload;
- production build includes the dependency because the bundler parses the final transformed code.

## Status

Runtime validation is delegated to the fork's draft PR CI. A red test is treated as a probe problem until logs show which assertion failed.
