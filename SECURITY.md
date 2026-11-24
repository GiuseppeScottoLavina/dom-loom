# Security

DomLoom runs in the browser: it draws the page's own HTML through WebGPU and adds no network access, storage or evaluation of strings.

## Reporting a problem

Please do not open a public issue for a security problem. Use GitHub's private reporting instead: the **Security** tab of this repository → **Report a vulnerability**. Include the browser, the render path (`data-renderer`, `data-mode`) and the steps to reproduce.

You will get an answer within a week. Fixes are released as a patch version and noted in [CHANGELOG.md](CHANGELOG.md).

## Supported versions

Only the latest release receives fixes.
