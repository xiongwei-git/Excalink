# Third-party notices

This inventory covers the locked production npm dependency tree, the fonts copied into the Web build, and the upstream material incorporated into this project.

- [npm-inventory.json](npm-inventory.json) lists package, version, license metadata and packaged notice filenames. Optional platform packages are included even when not installed on the generating machine.
- [npm-license-texts.txt](npm-license-texts.txt) contains the packaged license and notice texts available on the generating machine. Package metadata without a standalone text is listed separately in the inventory. Supplementary upstream texts for those packages are in [supplemental](supplemental/SOURCES.md). Radix packages share the Radix Primitives notice.
- [Excalidraw-MIT.txt](Excalidraw-MIT.txt) is the Excalidraw v0.18.1 license. [mcp-excalidraw-MIT.txt](mcp-excalidraw-MIT.txt) covers the diagram guide incorporated from yctimlin/mcp_excalidraw at commit 81720ac819d2325177cd6137c6ad41d52d0f5374.
- Font families in the Web build: Assistant, Cascadia Code, Excalifont, Lilita One, Nunito, Virgil and Xiaolai have OFL references in [supplemental](supplemental/SOURCES.md). Comic Shanns has MIT text embedded in its font metadata. Liberation Sans WOFF2 identifies itself as 1.05, with Ascender copyright and a legacy license reference. The included archived 1.07.3 texts document the legacy family terms, but are not evidence that the exact 1.05 binary carries the identical terms. Verify this binary or replace it before public redistribution.
- The Docker base is the official Node Debian Bookworm slim image. OS package attribution is kept with the base distribution where present. Run `dpkg-query -W` in the built image to inventory its exact OS package versions.
- Playwright is a runtime dependency for MCP rendering. The Docker image installs Playwright’s Chromium headless shell and its operating-system dependencies. Browser binaries are not stored in this repository. Tinyauth is an optional external identity provider.

Run `npm ci && npm run notices` after changing the npm lockfile. Build copies this directory to `dist/notices/`. Excalink’s own source code is covered by the [MIT License](../LICENSE).
