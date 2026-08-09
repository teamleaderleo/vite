# Browser trial result

Target revision: `8a245726944ed29225920d49be77c33c6e03afc8`.

Branch commit tested: `ca6474e60ebc0879df7c4c286608d28e91e30368`.

Focused workflow: `Fieldwork bundled hotUpdate browser probe`, run `30478771510`.

## Result

The classic and bundled browser comparisons both passed their expected assertions.

Classic dev:

- initial virtual state: `alpha`;
- external file watcher marker reached the browser;
- plugin `hotUpdate` custom event reached the browser;
- visible state changed to `beta`;
- custom state update count became `1`.

Bundled dev:

- initial virtual state: `alpha`;
- the same external file watcher marker reached the browser;
- plugin `hotUpdate` custom event did not reach the browser;
- visible state remained stale at `alpha`;
- custom state update count remained `0`.

The watcher marker rules out a missed filesystem event. The difference occurs after `watchChange`, at the bundled-development HMR path that returns before plugin `hotUpdate` handling.

## Qualification

Bundled development is experimental and its third-party plugin limitations are documented. This is a reproduced compatibility gap with a browser-visible stale-state consequence, not a claim that the mode currently promises full plugin compatibility.
