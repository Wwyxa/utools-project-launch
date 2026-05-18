# Research: uTools Theme Handling

- **Query**: Research how to handle theme (light/dark) switching in a uTools plugin.
- **Scope**: External (uTools API) / Internal (Workspace Structure)
- **Date**: 2026-05-18

## Findings

### 1. uTools Theme APIs

| API                        | Description                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `utools.isDarkColors()`    | Returns `true` if the current theme is dark. This is the official way to check the theme state. |
| `utools.onPluginReady(cb)` | Good place to initialize the theme when the plugin starts.                                      |

### 2. Theme Change Events

uTools does **not** provide a specific `utools.onThemeChange` event. However, because uTools runs in an Electron environment and follows system settings:

- **Standard Web API**: `window.matchMedia('(prefers-color-scheme: dark)')` can be used to listen for system-level theme changes.
- **Polling / Life-cycle**: Since uTools doesn't always trigger a standard media query change when the _user manually_ toggles the theme in uTools settings (without changing system theme), it is recommended to check `utools.isDarkColors()` on `onPluginEnter`.

### 3. Best Practices for "Follow System"

- **Tailwind Strategy**: Use the `class` strategy for dark mode.
  ```javascript
  // In App.vue or main.ts
  const updateTheme = () => {
    const isDark = utools.isDarkColors();
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  utools.onPluginEnter(() => {
    updateTheme();
  });
  ```
- **Media Query Listener**:
  ```javascript
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    // Note: Only works reliably if uTools is in "Follow System" mode
    updateTheme();
  });
  ```
- **CSS Variables**: Define theme colors in `src/index.css` using Tailwind's `@theme` or standard CSS variables to ensure consistency.

### 4. Codebase Recommendations

- **Type Safety**: Install `utools-api-types` as a dev dependency to get proper autocomplete for `utools` global.
- **Centralized Store**: Use `useStore.ts` to manage the theme state and provide a toggle if "Follow System" is not desired by the user.

## Related Specs

- `.trellis/spec/frontend/component-guidelines.md` — Mentioning theme tokens.

## Caveats / Not Found

- uTools' manual theme toggle (within uTools settings) might not trigger a `matchMedia` event if the system theme hasn't changed. Re-checking on `onPluginEnter` is the safest fallback.
