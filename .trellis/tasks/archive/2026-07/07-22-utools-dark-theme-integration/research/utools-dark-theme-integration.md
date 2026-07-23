# Research: uTools Dark Theme Integration

- **Query**: Research the minimal correct approach for integrating this Vue 3 uTools plugin's dark theme with the uTools host.
- **Scope**: Mixed (official uTools documentation, repository code, archived task evidence, and frontend specs)
- **Date**: 2026-07-22

## Recommendation Summary

Use the theme system that already exists. Do not add a composable, dependency, host-theme field, or second class/token tree.

1. Keep `store.theme` as the user preference (`light | dark | auto`) and keep the root `.dark` class as the only resolved theme state.
2. In the existing `window.utools.onPluginEnter(...)` callback in `src/App.vue`, call the existing `updateTheme()` before starting the asynchronous project-entry work. This is the smallest lifecycle fix and makes every delivered uTools enter event a host-theme reconciliation point.
3. Keep the existing `prefers-color-scheme` listener for live changes and browser preview. Keep the existing mount-time call for initial rendering.
4. Limit visual changes to the existing `.dark` semantic variables and the nearby dashboard-specific dark variables in `src/index.css`. Move the blue-gray surfaces toward a neutral charcoal ladder, preserve the green semantic accent/status family, and leave light tokens and syntax-preview tokens unchanged.
5. No theme-related change is required in `src/global.d.ts`: `isDarkColors(): boolean` and `onPluginEnter(...)` are already declared. Narrowing the entry action from `unknown` is a separate typing task and would not improve theme correctness.

The minimal lifecycle edit is conceptually:

```ts
window.utools?.onPluginEnter?.((action) => {
  updateTheme();
  void handlePluginEnter(action);
});
```

This preserves explicit `light` and `dark` choices because `updateTheme()` already consults the store preference before consulting the host.

## Official uTools Evidence

### Verified Claims

| Claim                                     | Official evidence                                                                                                                                                                   | Conclusion                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utools.isDarkColors()` exists            | The current Window API page defines `function isDarkColors(): boolean`.                                                                                                             | Yes. It is a synchronous API returning a boolean.                                                                                                 |
| Return meaning                            | The official example assigns `"dark-mode"` when `utools.isDarkColors()` is truthy, and the official documentation index describes the boolean as whether the current theme is dark. | `true` means the current uTools color theme is dark; `false` means it is not dark.                                                                |
| Native media query recommendation         | The Window API page says `更推荐 web 原生方式判断` and demonstrates `window.matchMedia('(prefers-color-scheme: dark)').matches` plus an `addEventListener('change', ...)` listener. | `prefers-color-scheme` is explicitly recommended for detection and change listening.                                                              |
| `utools.onPluginEnter(callback)` behavior | The Events API page says `进入插件应用时，uTools 将会主动调用这个方法。` and defines `function onPluginEnter(callback: (action: PluginEnterAction) => void): void`.                 | Registering the callback gives an entry event with a `PluginEnterAction`; each delivered entry event is an appropriate resynchronization point.   |
| Entry action shape                        | The same page lists `code`, `type`, `payload`, `from`, and optional `option`.                                                                                                       | The local `unknown` action type is permissive but sufficient for the existing tolerant parser. Theme synchronization does not consume the action. |

### Official URLs

- [Window API: `utools.isDarkColors()`](https://www.u-tools.cn/docs/developer/api-reference/utools/window.html#utools-isdarkcolors)
- [Events API: `utools.onPluginEnter(callback)`](https://www.u-tools.cn/docs/developer/api-reference/utools/events.html#utools-onpluginenter-callback)
- Context7 also surfaced the older official Window API URL `https://www.u-tools.cn/docs/developer/utools-api/window.html`; the current `api-reference/utools/window.html` page above was fetched directly and should be cited as canonical evidence.

### Exact External Research Commands

All external research used the repository-approved `smart-search` CLI. No native web search, GitHub search, `curl`, or `wget` route was used.

```powershell
smart-search doctor --format json
smart-search context7-library "uTools" "official developer API isDarkColors onPluginEnter dark theme" --format json
smart-search context7-docs "/websites/u-tools_cn_developer" "isDarkColors return value prefers-color-scheme recommendation onPluginEnter callback timing every plugin entry" --format json
smart-search context7-docs "/websites/u-tools_cn_developer" "utools.onPluginEnter event callback when it fires each time plugin enters payload code type" --format json
smart-search fetch "https://www.u-tools.cn/docs/developer/api-reference/utools/window.html" --format markdown
smart-search fetch "https://www.u-tools.cn/docs/developer/api-reference/utools/events.html" --format markdown
```

### External Evidence Limitations

- `smart-search doctor --format json` returned `ok: true` and `minimum_profile_ok: true`. Context7 documentation lookup and Tavily-backed fetch were available. Exa, Firecrawl, and Zhipu were not configured; they were unnecessary because Context7 located the official uTools corpus and the two official pages were fetched directly.
- The first combined Context7 docs query returned the Window API material but omitted the event material, so a second event-specific query was required.
- Both Context7 docs responses placed the useful indexed text in the JSON-encoded `content` field while their top-level `results`, `code_snippets`, and `info_snippets` arrays were empty. Claims above were therefore cross-checked against fetched official pages.
- The Markdown fetch duplicates some rendered code tokens because of the documentation site's generated markup. The relevant headings, signatures, prose, and examples remain readable.
- The Events API says the callback is actively invoked when entering the plugin. It does not separately document registration replay, callback removal, event deduplication, or whether renderer media-query events are delivered while a plugin is hidden. The implementation should not assume hidden-renderer delivery; it should simply re-query on every entry callback that uTools delivers.
- The official docs do not publish an authoritative uTools host dark palette. Exact neutral surface values must be calibrated in the real host or against the supplied visual reference; they cannot be claimed as official colors.

## Current Repository Flow

### Files Found

| File Path                                                           | Description                                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| `src/App.vue`                                                       | Owns theme resolution, root `.dark` mutation, mount/watch/media-query triggers, and the uTools entry callback.                                        |
| `src/index.css`                                                     | Owns light and dark semantic tokens, dashboard theme variables, native control colors, scrollbars, code preview colors, and shared floating surfaces. |
| `src/global.d.ts`                                                   | Declares the optional `window.utools` boundary, including `isDarkColors()` and `onPluginEnter(...)`.                                                  |
| `src/store/useStore.ts`                                             | Stores the user's `light                                                                                                                              | dark | auto` preference; it does not store a second resolved host-theme value. |
| `src/components/project/ProjectDetails.vue`                         | Enumerates the major project-detail surfaces: Scripts, Automation, Files, Git, and Memo; terminal UI is consumed from the detail flow.                |
| `.trellis/tasks/archive/2026-07/07-20-improve-dark-theme/prd.md`    | Establishes token reuse, dark-only palette changes, light-mode preservation, and the prior full-interface validation surface.                         |
| `.trellis/tasks/archive/2026-07/07-20-improve-dark-theme/design.md` | Establishes `src/index.css` dark tokens plus dashboard overrides as the visual implementation boundary.                                               |

### Theme Data and Lifecycle

```text
store.theme preference
  -> App.vue updateTheme()
     -> explicit light/dark, or auto detection
        -> uTools: isDarkColors()
        -> browser fallback: matchMedia(...).matches
     -> document.documentElement.classList(.dark)
        -> src/index.css semantic tokens
           -> all token-consuming views and overlays
```

Evidence:

- `src/store/useStore.ts:1004` initializes `theme` to `"auto"`; `src/store/useStore.ts:1181-1183` only updates that preference.
- `src/App.vue:109-122` resolves `auto`, applies/removes the root `.dark` class, and already falls back to `prefers-color-scheme` when `window.utools` is unavailable.
- `src/App.vue:124-127` re-runs resolution when the preference changes and on mount.
- `src/App.vue:129-131` registers `onPluginEnter` but currently only calls `handlePluginEnter(action)`.
- `src/App.vue:145,154` installs/removes a media-query change listener.
- `src/global.d.ts:5-9` makes the whole `utools` object optional for browser preview and already declares both required APIs.

### Lifecycle Gap

The current entry callback restores projects/runtime state and handles launcher search text, but it does not rerun `updateTheme()`. The falsifiable local hypothesis is:

> In `auto` mode, if uTools changes theme while this plugin renderer is hidden and no usable media-query change reaches the renderer, the existing root `.dark` class remains stale after re-entry.

The cheapest discriminating check is:

1. Enter the plugin in uTools with `auto` selected and record `document.documentElement.classList.contains('dark')`.
2. Hide the plugin, switch the uTools host theme, and enter the plugin again.
3. Compare the root class with `utools.isDarkColors()`.

The proposed one-line entry synchronization fixes exactly that mismatch. It is preferable to adding theme work to focus/visibility handlers because the acceptance requirement and official lifecycle API already identify plugin entry as the host boundary.

### Palette Direction and Existing Boundary

The archived design explicitly confines visual changes to `src/index.css` `.dark` semantic tokens and dashboard dark overrides (`design.md:3-5`). Its PRD requires all major views to inherit the change through shared tokens, preserves green as the primary/status accent, and excludes the existing GitHub-style syntax palette (`prd.md:17-24,28-35`).

The current surface ladder is visibly blue-weighted:

| Role                            | Current value(s)                  | Evidence                        | Minimal direction                                                                                   |
| ------------------------------- | --------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| App background / lowest surface | `#171c23`                         | `src/index.css:109,138`         | Neutral charcoal; keep it the darkest main layer without approaching pure black.                    |
| Low / standard surfaces         | `#1b2129`, `#20262e`, `#242b34`   | `src/index.css:106,110-111`     | Reduce the blue-channel lead and keep a small monotonic lightness step between layers.              |
| Raised / hover surfaces         | `#2a323c`, `#323b47`, `#343d48`   | `src/index.css:108,112-113,140` | Neutral raised charcoal with enough separation for cards, menus, inputs, and hover/selected states. |
| Text                            | `#d8dee6`, `#9da8b5`              | `src/index.css:114-115`         | Neutral high/secondary text; preserve readable contrast without blue tint.                          |
| Outline / subtle border         | `#3a4552`, `#303944`              | `src/index.css:119,146`         | Neutral gray slightly above adjacent surfaces; avoid bright framing.                                |
| Toolbar / controls              | blue-gray RGBA and surface values | `src/index.css:151,155-156`     | Derive from the same neutral ladder; do not create a toolbar-only palette.                          |

A reasonable non-authoritative starting ladder for host calibration is approximately `#202020` (background/lowest), `#252525` (low), `#292929`/`#2d2d2d` (standard surfaces), `#333333` (high/hover), and `#3a3a3a` (highest/floating), with neutral text around `#e2e2e2` and `#aaa`. These are implementation starting points, not uTools-published values. Final values should be judged in the actual uTools host.

Do not change the light `@theme` block (`src/index.css:3-103`) or syntax variables unless a concrete regression proves it necessary. Keep host-critical selected, focused, error, disabled, compact metadata, and action-control colors explicit in the dark theme rather than relying only on `color-mix()` or opacity modifiers.

## Applicable Frontend Specs

| Spec                                                             | Applicable constraint                                                                                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `.trellis/spec/frontend/component-guidelines.md:62,718-722`      | Use semantic design tokens; `App.vue` owns the global `light                                                                                                         | dark | auto`listener; auto currently prioritizes`isDarkColors()`with media-query fallback; dark values are`.dark` CSS-variable overrides. |
| `.trellis/spec/frontend/directory-structure.md:9-15`             | `App.vue` is the composition root and `index.css` owns global theme tokens.                                                                                          |
| `.trellis/spec/frontend/hook-guidelines.md:5-24`                 | Keep one-view lifecycle logic in the component; do not create a composable before reuse exists.                                                                      |
| `.trellis/spec/frontend/state-management.md:1620-1650`           | `App.vue` owns `onPluginEnter` because it coordinates app-level entry behavior; `global.d.ts`, `App.vue`, lint, build, and uTools smoke must remain aligned.         |
| `.trellis/spec/frontend/state-management.md:21-36`               | Pure resolved visual state should not be duplicated in Pinia. The existing store preference is sufficient.                                                           |
| `.trellis/spec/frontend/quality-guidelines.md:13-14,20-38,47-48` | No hard-coded component colors when semantic tokens exist; host-critical states need explicit per-theme values; run lint and build and manually inspect major flows. |
| `.trellis/spec/frontend/type-safety.md:5-34`                     | Keep window APIs typed and avoid duplicate or broad new models. Existing declarations are sufficient for this theme-only change.                                     |
| `.trellis/spec/guides/code-reuse-thinking-guide.md`              | Reuse the existing `updateTheme()` and token tree; do not create a second resolver or duplicate constants.                                                           |
| `.trellis/spec/guides/cross-layer-thinking-guide.md`             | Validate the host API -> app lifecycle -> root class -> CSS token -> view chain as one boundary.                                                                     |

## Minimal Implementation Boundary

### Required

1. **`src/App.vue`**: add `updateTheme()` to the already-registered `onPluginEnter` callback. Keep mount, preference watch, media listener, and browser fallback intact.
2. **`src/index.css`**: adjust only existing `.dark` semantic surface/text/border/scrollbar/dashboard-control values needed to neutralize the palette. Prefer shared-token edits over component overrides. Update a local dark override only when it cannot inherit the corrected token.

### Not Required

- No dependency or theme framework.
- No new composable/helper; `updateTheme()` is local and has one owner.
- No second Pinia field for `isHostDark` or `resolvedTheme`.
- No new body class, data attribute, duplicated token namespace, or component-level theme props.
- No manifest or preload change; both APIs are renderer-facing `window.utools` APIs already available to this app.
- No `src/global.d.ts` change for theme behavior. Exact `PluginEnterAction` typing can be handled independently if desired, but it would widen this task without changing runtime behavior.
- No component template/layout edits unless manual validation identifies a hard-coded dark color that demonstrably bypasses the existing tokens.

## Validation Matrix

### Automated and Structural Checks

| Check                                                               | Expected result                                           | Why                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| `npm run lint`                                                      | TypeScript passes.                                        | Verifies `App.vue` and `global.d.ts` remain aligned.          |
| `npm run build`                                                     | Vite production build passes.                             | Verifies the Vue entry integration and CSS compile.           |
| Search for newly introduced raw dark colors outside `src/index.css` | No new component palette.                                 | Prevents a second theme system and missed shared-token reuse. |
| Search for `isDarkColors`, `updateTheme`, and `onPluginEnter`       | One resolver and one app-level entry registration remain. | Prevents duplicate lifecycle/theme ownership.                 |

There is no existing focused component test for the host event boundary. A build cannot prove host lifecycle delivery, so uTools smoke testing remains required.

### Theme Source and Lifecycle

| Environment / preference                    | Action                                                           | Expected result                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Browser preview, `auto`, no `window.utools` | Start in light/dark OS mode, then change `prefers-color-scheme`. | Root `.dark` follows `matchMedia`; no runtime exception.                              |
| uTools, `auto`, initial entry               | Enter once in host light and once in host dark.                  | Root `.dark` equals `utools.isDarkColors()` immediately after entry.                  |
| uTools, `auto`, hidden theme change         | Hide plugin, change host theme, re-enter.                        | Entry callback corrects any stale root class. This is the acceptance-critical case.   |
| uTools, `auto`, visible theme change        | Change host theme while plugin remains visible.                  | Existing media-query listener updates the root class.                                 |
| Browser or uTools, explicit `light`         | Change OS/host theme and re-enter.                               | Root remains light; host auto-detection does not override the user's explicit choice. |
| Browser or uTools, explicit `dark`          | Change OS/host theme and re-enter.                               | Root remains dark.                                                                    |
| Repeated enter/hide cycles                  | Enter the same plugin several times.                             | No duplicate theme system, flicker, or accumulating visible side effects.             |

### Major Interface Visual Coverage

Run the matrix in both light and dark modes at a normal desktop size and a compact uTools-like window size.

| Surface               | Required observations                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard             | Outer background blends with the host; toolbar, group/filter chips, regular/tiny cards, unavailable cards, scrollbars, hover action bars, focus, selected, running, warning, disabled, and pressed states remain distinct. |
| Project Details shell | Header, tab strip, separators, panel backgrounds, back/actions, and terminal region use one neutral surface ladder without blue islands.                                                                                   |
| Scripts               | Script rows, run/stop states, menus, logs, disabled controls, and status colors remain legible.                                                                                                                            |
| Automation            | Inputs, plan/history rows, date/dropdown popovers, running/missed/error states, and dialogs preserve hierarchy.                                                                                                            |
| Files                 | Tree, toolbar, context menu, find widget, preview/editor, gutter, selection, search marks, and code syntax remain readable; syntax tokens should not change.                                                               |
| Git                   | Status/header, changed-file rows/actions, graph/history, tooltips, dialogs, AI result panels, menus, selected/focused/error states, and code diffs retain separation.                                                      |
| Memo                  | Editor/preview, todo rows/actions, markdown surfaces, inline code, code blocks, links, and floating controls remain readable.                                                                                              |
| Settings              | Theme segmented control, inputs, custom dropdowns, focus/disabled states, and nested settings sections use the same tokens.                                                                                                |
| Environment           | Tool cards/rows, skeletons, refreshing/error/available states, controls, and compact overflow remain clear.                                                                                                                |
| Global overlays       | Project form, delete confirmation, teleported modals, dropdowns, date pickers, context menus, tooltips, shadows, borders, and backdrops read as raised surfaces without bright outlines.                                   |
| Light regression      | All surfaces above retain their existing light palette and behavior; no dark-token change leaks into `@theme`.                                                                                                             |

For host integration, inspect the plugin's outside edges, empty areas, scrollbar track, and top toolbar next to the surrounding uTools window. These areas reveal color-temperature discontinuity sooner than content-heavy cards do.

## Caveats / Not Found

- `python ./.trellis/scripts/task.py current --source` returned `Current task: (none)` / `Source: none` even though the user supplied and the repository contains `.trellis/tasks/07-22-utools-dark-theme-integration`. This research uses the explicit user-provided task path and does not create or activate another task.
- No current `design.md` or `implement.md` exists in the target task directory; only its `prd.md`, task metadata, and JSONL logs were present.
- No official uTools dark color values were found in the fetched API documentation. Palette values must be treated as project design choices validated against the host, not API contracts.
- No application code, current task PRD/design/implementation artifacts, manifests, specs, or archived task files were modified during this research.
