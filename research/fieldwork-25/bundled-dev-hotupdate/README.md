# Bundled development plugin hot-update browser trial

Target revision: `8a245726944ed29225920d49be77c33c6e03afc8`.

This branch turns the third Fieldwork #25 source finding into a browser-visible comparison using Vite's own playground harness. The same fixture runs in ordinary serve mode and again with `VITE_TEST_BUNDLED_DEV=1`.

## Scenario

A plugin exposes a virtual module backed by `plugin-state.txt` without adding the text file to the bundler graph. This is deliberate: the plugin owns updates for that external state through its `hotUpdate` hook.

The browser starts with `alpha` and listens for two custom events:

- `fieldwork:watch-seen`, sent by `watchChange`;
- `fieldwork:state`, sent by `hotUpdate` with the new value.

The test changes the backing file to `beta`.

## Expected comparison

Classic dev:

- `watchChange` observes the file event;
- `hotUpdate` runs;
- the custom state event reaches the browser;
- visible state becomes `beta` without reloading.

Bundled dev:

- `watchChange` observes the same file event;
- Vite returns from HMR handling before `hotUpdate`;
- the custom state event is absent;
- visible state remains stale at `alpha`.

## Files

- `playground/plugin-hot-update/vite.config.ts`
- `playground/plugin-hot-update/main.js`
- `playground/plugin-hot-update/plugin-state.txt`
- `playground/plugin-hot-update/__tests__/plugin-hot-update.spec.ts`
- `draft-issue.md`

This is an internal research branch in `teamleaderleo/vite`. It does not contact `vitejs/vite`.
