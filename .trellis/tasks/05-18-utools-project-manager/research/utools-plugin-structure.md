# uTools Plugin Structure Notes

## Key takeaways

- A uTools plugin must include `plugin.json` as the entry config.
- `plugin.json` must define `logo` and either `main` or `preload`; for this app we need both, because the UI is a normal HTML entry and the local runtime helpers live in `preload`.
- `main` must point to an `.html` file relative to `plugin.json`.
- The packaged plugin should ship built output, typically the `dist` folder contents, rather than the project root.
- Frontend dependencies can be bundled normally by Vite.
- Node-side dependencies used by `preload.js` must remain alongside `preload.js` and stay readable, not minified or bundled into the frontend output.

## Practical implications for this repo

- The Vite app should continue building to a distributable `dist` directory.
- Plugin packaging needs a root-level `plugin.json`, `logo` asset, and `preload.js` next to the built HTML entry.
- Runtime features like filesystem access, process execution, and project launching belong in `preload`, exposed to the Vue app via `window`.

## Sources consulted

- uTools file structure documentation
- uTools plugin.json documentation
- uTools preload documentation
- uTools first-plugin guide
