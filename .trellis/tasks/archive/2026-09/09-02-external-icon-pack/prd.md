# External icon pack support

## Goal

Give the project manager richer, consistent file and folder icons without increasing the installed size of the main uTools plugin. The application must be able to load an optional icon pack derived from `vscode-icons`, distributed as a separately downloadable GitHub Release asset.

## Background And Confirmed Facts

- `src/components/project/FileTreeNode.vue:77` currently maps a small hard-coded extension set to Lucide components.
- `src/components/project/GitChangesPane.vue:1300` and `src/components/project/GitCommitHistory.vue:2429` render Git file trees independently. Their directory rows use a fixed Lucide `Folder`; Git file rows expose the Git status code but do not show a file-type icon.
- Git operation icons such as branch, commit, diff, open-folder, and file-search actions express Git semantics rather than file type and must remain application-owned.
- `references/vscode-icons/` is reference material only. Its source and assets must not be loaded from that path at runtime or shipped accidentally by the Vite build.
- `vscode-icons` provides mature file-name, file-extension, folder-name, expanded-folder, and light/dark mapping data. Its extension host code and VS Code contribution points are not a runtime dependency of this application.
- The main application is a Vite + Vue frontend with a typed `ProjectBridge`, a CommonJS uTools preload, and versioned UI preference persistence.
- The existing Project Launch Service release flow demonstrates GitHub asset discovery, SHA-256 verification, bounded downloads, and atomic installation, but its service-specific protocol and executable naming must not be reused as the icon-pack contract.
- The upstream README distinguishes MIT-licensed source code from CC BY-SA 4.0 icon assets and separately notes that branded icons may have their own copyright licenses. The first pack will publish the complete referenced icon set without special brand-based exclusion, while preserving the upstream attribution and clearly distinguishing the applicable license categories.

## Requirements

### R1. Optional external package

The main plugin build must remain usable without downloading or bundling the icon pack. The icon pack is installed only after an explicit user action and is stored outside the plugin bundle under the existing application data root.

### R2. Stable package contract

Define a versioned, declarative icon-pack manifest owned by this project. It must identify the pack, its version, supported host/schema version, file-name mappings, extension mappings, folder mappings, expanded-folder mappings, light/dark assets, and license notices. The runtime must not execute JavaScript from a pack or require a VS Code extension host.

### R3. Derived `vscode-icons` pack

Add a reproducible build path that extracts the complete current icon set and mappings from `references/vscode-icons/`, reorganizes them into the project manifest, carries the upstream attribution and license notices, and emits a separately publishable compressed asset. The generated pack must be placed under an outer-project-owned directory such as `icon-packs/` or `tools/icon-pack/`, not under `references/`.

### R4. Shared resolution across views

Use one renderer-side resolver for project files, Git working-tree files, and Git commit files. Matching must support exact file names, extensions, directories, open directories, and a safe default fallback. Windows and POSIX separators must resolve identically.

### R5. Git file-row layout and semantics

Git working-tree and commit file rows must use one visual order: an optional themed file icon, the file name/path, addition/deletion counts when available, then the Git status code (`M/A/D/R/U`) at the end of the row. When the icon pack is not active, the themed icon node is omitted without a placeholder; the status code remains at the same trailing position. Status colors, accessible status labels, branch/tag/commit controls, diff controls, and other Git action icons must preserve their current semantics and accessibility.

### R6. Explicit install, update, switch, and fallback behavior

The settings surface must expose the installed pack state and allow the user to install or update the official pack, switch between the built-in fallback and an installed pack, and recover from an invalid or removed pack by falling back to Lucide icons. Startup must not silently download or activate an unavailable pack.

### R7. Persistence and compatibility

The selected pack and installation metadata must survive a complete uTools restart through the existing typed preference/preload boundary. Missing, malformed, unsupported, or incompatible metadata must normalize to the safe fallback without breaking unrelated preferences or file/Git views.

### R8. Release and attribution documentation

Publish the generated icon pack as an independent GitHub Release asset with a checksum. Update `README.md` with installation/use instructions, the external-pack size rationale, the derivation from `vscode-icons`, and third-party attribution. Ship the complete applicable license and notice files with the pack; README attribution alone is insufficient.

### R9. Global theme scope

The selected icon pack is application-wide. A single installed/selected pack must be used consistently by the project file tree, Git working-tree file list, and Git commit file list; project configuration and project import/export must not contain icon-pack identifiers.

## Acceptance Criteria

- [ ] A clean `npm run build` produces a working plugin without any icon-pack asset included in the plugin bundle.
- [ ] The outer project contains a reproducible icon-pack generation path and generated output is excluded from ordinary application bundling.
- [ ] The generated manifest passes runtime validation for schema, pack identity/version, mapping shapes, asset references, supported image formats, and size limits.
- [ ] An explicitly installed official pack is discovered, checksum-verified, installed atomically, and loaded after a restart; a failed verification leaves the previous valid pack intact.
- [ ] The selected theme is applied consistently to the project file tree, Git working-tree file list, and Git commit file list for file names, extensions, folders, and expanded folders.
- [ ] Missing or unsupported mappings render the existing Lucide fallback; invalid, removed, or incompatible installed packs do not blank any view.
- [ ] Git working-tree and commit file rows use the order optional themed icon, file name/path, change counts, and trailing `M/A/D/R/U` status code; when the pack is inactive no file-icon placeholder is rendered, while status labels/colors and Git operation icons remain unchanged.
- [ ] The selected theme is global across all projects and survives project switching without any project metadata changes.
- [ ] Browser fallback behavior remains functional without native preload APIs and reports the pack as unavailable rather than pretending an install succeeded.
- [ ] Focused tests cover manifest normalization, matching precedence, separator normalization, light/dark selection, fallback behavior, preference normalization, and checksum/install failure recovery.
- [ ] `README.md`, the generated pack, and the pack's release assets contain appropriate `vscode-icons` attribution and the complete upstream license/notice text, including the distinction between source code, icon assets, and branded icons.

## Out Of Scope

- Executing or installing arbitrary VS Code extension code.
- Full `.vsix` compatibility, marketplace integration, or arbitrary remote URL support in the first release.
- User-imported local theme directories in the first release.
- Per-project theme selection or project-level theme metadata.
- Replacing Git branch, commit, diff, push, tag, or file-action icons with theme assets.
- Shipping all available icon themes inside the main plugin bundle.
