# `watchChange` error-isolation experiment

Status: **probe-ready**

This directory is an internal lab for Fieldwork lane `teamleaderleo/fieldwork#25`. It targets Vite commit `8a245726944ed29225920d49be77c33c6e03afc8` and does not contact or publish anything to `vitejs/vite`.

## Question

When a plugin's `watchChange` hook rejects, does Vite still perform its own required file-change work?

The current watcher path awaits all environment `watchChange` hooks before it invalidates the module graph and invokes HMR. A rejection is caught by the outer watcher listener and logged. The candidate failure is that invalidation and HMR never run.

## Probe

`probe.mjs` creates a disposable Vite project containing a virtual module backed by a watched text file.

It runs two cases:

1. **Control:** `watchChange` succeeds. The virtual module's cached transform should be cleared and the next request should read `beta`.
2. **Rejection:** `watchChange` throws. On the pinned revision, the candidate result is that the error is logged, the cached transform survives, and the next request still returns `alpha`.

## Run

From the repository root:

```sh
corepack enable
pnpm install
pnpm build
node research/fieldwork-25/watchchange-error/probe.mjs
```

A dedicated branch workflow runs the same probe without the browser test matrix.

## Evidence levels

- **Source-confirmed:** watcher control flow places core invalidation and HMR after awaited plugin hooks.
- **Probe target:** stale transform cache after a rejecting hook.
- **Pending:** exact runtime output from this fork's pinned revision.

## Candidate fix direction

Plugin hook reporting and Vite cache maintenance should be isolated:

- collect or log rejected `watchChange` hooks;
- continue module-graph invalidation;
- continue HMR processing where safe;
- apply the same policy to `change`, `add`, and `unlink`;
- preserve all useful errors when plugin and HMR work both fail.

See `draft-issue.md` for the portable issue text and `proposed-fix.md` for implementation options.

## Vite+ cross-check

Vite+ contains a synced Vite workspace. After this probe is confirmed and the fix semantics are settled here, repeat the scenario against the Vite revision currently synced into `teamleaderleo/vite-plus`. Keeping the first experiment in the plain Vite fork avoids mixing Vite+ CLI and Rust build variables into a server-cache bug.
