# Technical Design: External Icon Packs

## Change Boundary

The smallest behavior gap is that file nodes in the project tree and Git file views have only a small hard-coded Lucide mapping or a fixed folder icon. The behavior belongs in one shared renderer-side file-icon resolver, with the preload owning external package acquisition and persistence.

Expected implementation files:

- `src/types.ts`: shared icon-pack, preference, status, and bridge contracts.
- `src/lib/fileIconTheme.ts`: pure manifest validation, matching, and fallback resolution.
- `src/lib/projectBridge.ts`: browser fallback for icon-pack bridge methods.
- `src/store/useStore.ts`: global selected-pack state, load/install/update/remove actions, and startup loading.
- `src/components/common/FileIcon.vue`: one rendering boundary for themed image icons and current Lucide fallbacks.
- `src/components/project/FileTreeNode.vue`, `src/components/project/GitChangesPane.vue`, and `src/components/project/GitCommitHistory.vue`: consume `FileIcon.vue` for file and directory rows only.
- `src/components/layout/SettingsTab.vue` and `src/lib/i18n.ts`: manual pack controls and localized status text.
- `public/preload/icon-packs.js` and `public/preload.js`: native package discovery, download, validation, atomic installation, and bridge exposure.
- `public/preload/preferences.js`: versioned global selection preference normalization.
- `scripts/build-icon-pack.mjs` and `scripts/validate-icon-pack.mjs`: extraction, packaging, and release validation.
- `icon-packs/vscode-icons-derived/`: project-owned extracted source assets and notices. This directory is outside `public/` and is never copied into the uTools plugin bundle.
- `.github/workflows/icon-pack-release.yml`, `.gitignore`, `package.json`, and `README.md`: release packaging, generated-output exclusion, commands, and attribution/use documentation.

Explicitly unchanged: the Go Project Launch Service, Git command/data contracts, project metadata schema, Git operation icons, and the `references/vscode-icons/` directory.

## Package Layout And Build Flow

The repository owns the extracted pack under:

```text
icon-packs/
└── vscode-icons-derived/
  ├── manifest.json   # generated source manifest with relative asset paths
  ├── icons/           # extracted SVG/PNG files used by the pack
  └── LICENSES/        # complete applicable upstream notices
```

The upstream `vscode-icons` source is a build-time reference when available. `scripts/build-icon-pack.mjs` reads the upstream generated VS Code icon manifest and referenced assets, takes the upstream version from `references/vscode-icons/package.json`, carries the complete current icon set without special brand-based exclusion, records the upstream attribution/license notices, normalizes the mapping into the project schema, and writes the project-owned `icon-packs/vscode-icons-derived/` directory. In a clean checkout without the local upstream reference, it validates the checked-in source package and rebuilds the independent Release asset from it. It must fail when a referenced asset is missing or malformed, but it does not remove an icon solely because it is branded.

The packaging command embeds validated SVG/PNG content as base64 data in one compressed JSON file:

```text
icon-packs/vscode-icons-derived/icon-pack-release/
├── utools-project-launch-vscode-icons-derived-<version>.iconpack.json.gz
└── checksums.txt
```

The generated release directory is ignored by Git. The Vite build only reads `index.html` and `public/`, so the source assets under `icon-packs/` do not increase the installed plugin size. The release workflow runs the generator, validator, checksum creation, and GitHub Release upload independently from `service-v*` releases.

The generator may use a local `vscode-icons` source checkout and its own build output as an input, but no reference-package JavaScript is copied into the runtime or executed by the installed plugin. The generated package contains data and notices only.

## Runtime Package Contract

The packaged JSON uses schema version `1`:

```ts
type IconVariant = { dark: string; light?: string };

interface IconPackManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  minHostVersion?: string;
  source: {
    repository: string;
    version: string;
    url: string;
  };
  mappings: {
    fileNames: Record<string, IconVariant>;
    fileSuffixes: Record<string, IconVariant>;
    folderNames: Record<string, IconVariant>;
    folderNamesExpanded: Record<string, IconVariant>;
    defaults: {
      file: IconVariant;
      folder: IconVariant;
      folderExpanded: IconVariant;
    };
  };
  assets: Record<string, {
    format: "svg" | "png";
    encoding: "base64";
    data: string;
  }>;
  notices: Array<{
    id: string;
    license: string;
    text: string;
    appliesTo: string;
  }>;
}
```

All mapping keys are normalized to lowercase. File suffixes include the leading dot and may contain multiple segments, such as `.component.ts`; the resolver chooses the longest matching suffix. Asset IDs and mapping references must point to an asset in the same manifest. The runtime accepts only `svg` and `png`, bounded data sizes, and inline base64 content; it rejects external URLs, script-bearing SVG constructs, event attributes, `javascript:` references, and unsupported formats.

The source manifest may use relative `path` fields while the release manifest uses inline `data`. The packaging step is the only place allowed to convert source paths into data. The runtime never resolves arbitrary paths from a downloaded manifest.

## Resolution And Rendering

`src/lib/fileIconTheme.ts` is pure and receives an optional validated pack plus `{ name, path, kind, expanded, colorMode }`. Resolution precedence is:

1. exact file name;
2. longest file suffix;
3. exact directory name, with the expanded variant when applicable;
4. pack default file/folder icon;
5. the existing Lucide fallback mapping.

The resolver normalizes `\\` and `/` separators, strips trailing separators, and never throws for a missing or malformed pack. It returns either an inline image source or a fallback Lucide component key. `FileIcon.vue` owns the rendering distinction, fixes the icon box dimensions, marks image icons decorative, and retains an accessible label through the surrounding file row. It accepts an explicit fallback policy: `lucide` for the project file tree and `omit` for Git file rows when no active external pack exists. Asset icons keep their own colors; selection and file-tree state remain expressed by the surrounding UI.

The same component is used by:

- the project file tree for files and collapsed/expanded directories;
- the Git working-tree change list for files and directories;
- the Git commit file list for files and directories.

`GitChangesPane.vue` and `GitCommitHistory.vue` render Git file rows in the same order: optional themed file image, file name/path, additions/deletions, and the trailing status code. The optional image is rendered only when the global icon pack is active; an inactive pack omits that node rather than rendering the Lucide fallback or reserving an empty slot. Status colors, accessible status labels, status badges, and row action buttons remain application-owned. Branch, tag, commit, file-search, diff, and open-folder icons are not passed through the file resolver.

The project file tree may continue to use the existing Lucide fallback when no pack is active. This is intentionally different from Git file rows, where the user-selected layout has no icon placeholder in the inactive state.

Color mode follows the application root theme (`.dark`) with a safe dark/default fallback. A missing light asset inherits the dark asset. A theme change must invalidate the rendered resolver result without requiring a file-tree reload.

## Native Boundary And Persistence

The preload owns a single application-data directory:

```text
~/.utools-project-launch/
└── icon-packs/
    └── vscode-icons-derived/
        ├── pack.json.gz
        └── install.json
```

`install.json` contains only `{ schemaVersion, packId, version, assetName, sha256 }`. The selected pack ID is stored in the existing versioned UI preference document as `iconPackId`, defaulting to `builtin`. Pack contents and installation metadata are not stored in `dbStorage`, `localStorage`, or project documents.

The typed bridge exposes these operations:

- `loadInstalledIconPack()` reads, decompresses, validates, and returns the installed manifest or a typed unavailable/invalid result.
- `getIconPackStatus()` reports installed, unavailable, invalid, and active/version information without downloading.
- `checkIconPackUpdate()` queries the known GitHub repository's icon-pack releases and reports an available version without changing disk state.
- `downloadIconPack()` downloads only the official asset after explicit user action, verifies SHA-256, validates the complete manifest, and atomically installs it.
- `removeIconPack()` removes the installed optional pack only after it is inactive or switches the global selection to `builtin` first.

The browser fallback implements the same signatures with `unavailable` results and never claims a successful download or installation. Vue components call Store actions; only the Store calls `src/lib/projectBridge.ts`; only preload touches disk and network.

The update lookup uses the fixed project repository and an icon-pack release tag prefix, not the service `releases/latest` endpoint. It accepts only HTTPS GitHub hosts, bounded redirects, known asset names, bounded compressed/decompressed sizes, and a valid checksum entry. A failed download, parse, validation, or install leaves the previous valid pack and metadata untouched.

## GitHub Release Contract

Icon-pack releases use an independent tag family such as `icon-pack-v1.0.0`. The tag version is the icon-pack version and is independent from `source.version`, which records the upstream `vscode-icons` version. Each release contains:

```text
utools-project-launch-vscode-icons-derived-1.0.0.iconpack.json.gz
checksums.txt
LICENSES-vscode-icons.txt
```

The workflow does not modify or depend on `service-release.yml`. It validates that the package ID/version agree with the tag, that all assets are referenced and license-classified, that the compressed and expanded limits are respected, and that the checksum file verifies before publishing.

## Licensing And Attribution

The reference package states that its source code is MIT-licensed, its icons are CC BY-SA 4.0, and branded icons may have separate copyright licenses. The first release does not selectively exclude branded icons. The pack carries the complete upstream notices and clearly repeats the distinction in its metadata and README; it does not relabel the complete icon set as MIT-licensed.

The project README explains that the pack is derived from `vscode-icons`, links to the upstream repository, documents the pack-specific licensing, and explains that the reference package is not bundled or executed. The release asset carries complete applicable notices. The main plugin README is not treated as a substitute for notices distributed with the pack.

## Failure And Rollback Behavior

- No installed pack: use the existing Lucide mapping immediately.
- Preference selects an absent pack: show fallback icons and an actionable unavailable status; do not blank the tree or Git views.
- Invalid compressed bytes, JSON, schema, asset, mapping, or notice: reject the candidate and preserve the previous install.
- Checksum mismatch: delete only temporary download files and retain the previous install.
- Atomic rename or metadata write failure: restore the previous pack and metadata where possible.
- Removed active pack: switch the global preference to `builtin` before deletion.
- Network or GitHub API failure: keep the current pack and report a non-destructive settings error.

## Validation Strategy

Pure resolver tests cover precedence, compound suffixes, path separators, folder state, light/dark fallback, invalid-pack fallback, and legacy/default Lucide behavior. Preload/bridge tests cover preference normalization, official-release filtering, checksum mismatch, invalid package rejection, atomic replacement, removal, and browser unavailable results. Build tests verify the pack directory is not copied into `dist/`, while the package-generation validator verifies the release asset and notices.

Manual checks cover a fresh browser run, a full uTools close/reopen, theme switching, a narrow project tree, Git working-tree changes, expanded commit files, deleted/untracked files, and an update failure while an older pack is active.