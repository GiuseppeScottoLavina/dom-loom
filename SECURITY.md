# Security

DomLoom runs in the browser and draws the page's own HTML through WebGPU. Its own code makes no network requests, uses no storage and evaluates no strings. It loads its own chunks (the polyfill's loader and effects host) with dynamic imports, and on the polyfill path the bundled polyfill fetches the page's own images, fonts and stylesheets to draw them.

## Reporting a problem

Please do not open a public issue for a security problem. Use GitHub's private reporting instead: the **Security** tab of this repository → **Report a vulnerability**. Include the browser, the render path (`data-renderer`, `data-mode`) and the steps to reproduce.

You will get an answer within a week. Fixes are released as a patch version and noted in [CHANGELOG.md](CHANGELOG.md).

## Supported versions

Only the latest release receives fixes.
