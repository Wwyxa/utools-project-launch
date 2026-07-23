# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Frontend quality is enforced mostly through TypeScript checks and the current component conventions.

The repo currently exposes:

- `npm run lint` -> `tsc --noEmit`
- `npm run build` -> Vite production build

There is no dedicated test runner configured yet, so the quality baseline is type safety, build success, and layout sanity checks in the browser.

---

## Forbidden Patterns

- Hard-coded colors when a semantic token already exists in `src/index.css`
- Adding backend assumptions to a UI-only flow
- Leaving icon-only buttons without an accessible label
- Copying class strings by hand when the same pattern already exists in nearby components
- Replacing shared state with duplicated local state across tabs or panels
- Coloring routine startup or readiness messages red just because they came from stderr; inspect the log meaning and reserve danger tones for actual failures

---

## Required Patterns

- Use the shared type model from `src/types.ts`
- Use `cn` for conditional class composition when it improves readability
- Keep feature folders aligned with the current domain split
- Use `lucide-vue-next` icons already available in the repo
- Keep text, spacing, and color aligned with the design tokens in `src/index.css`
- For host-critical selected, focused, error, compact metadata, and action-control states, use explicit semantic token values per theme. Do not rely on `color-mix()` or Tailwind color opacity modifiers as the only dark-theme declaration because the uTools host may render them substantially dimmer than the development browser.
- Keep main scroll containers on `.themed-scrollbar` for consistent fallback styling, and add `v-overlay-scrollbar` to full-page scrollers and height-constrained popup lists so their overlay scrollbar does not reserve layout space or shift content when overflow changes

---

## Testing Requirements

Minimum checks for frontend changes today:

- run `npm run lint`
- run `npm run build`
- manually inspect the dashboard and project detail flows for layout overflow, broken tab switching, and clipped terminal output
- verify that normal readiness logs remain neutral/success-toned while real errors stay red
- for hover tooltips in dense panels, verify delayed appearance, tab switching/unmount cleanup, markdown rendering, and placement above/below the cursor in a compact window

If a test runner is added later, prefer focused component or store tests around the project shell and store mutations first.

---

## Code Review Checklist

- Props and events are typed
- New state lives in the right layer
- Icons, spacing, and colors follow the current design tokens
- The new UI still works without a backend
- No accidental use of `any` or duplicated domain models
- Floating UI is not clipped by parent overflow and does not jump far away from the trigger while hovering dense lists

### Common Mistake: Relying on Native Popups Inside Dense Panels

**Symptom**: A `select` or `input[type=date]` looks styled, but its browser popup still appears in the default system style or opens beneath the trigger where it gets clipped by the surrounding panel.

**Cause**: The trigger element was themed, but the actual popup remained native. Nested overflow containers, fixed-height dialogs, and compact settings panes make the browser's default popup behavior a poor fit.

**Fix**: Replace the picker with a local custom floating menu or calendar when the control sits inside a dense panel or dialog. Keep the value in the same store field, but own the popup surface and its placement.

**Prevention**: When reviewing compact dialogs and settings panes, check the full interaction, not just the trigger styling. If the popup is part of a dense surface, verify clipping, placement, and scrollbar behavior in the browser.

### Common Mistake: Over-Tall AI Dialogs with Duplicate Summary Cards

**Symptom**: The AI analysis dialog opens with a large blank area, a separate summary card, and an inner scrollbar that competes with the rest of the panel.

**Cause**: Scope metadata and setup controls were spread across too many stacked sections, and the result pane was given more vertical space than it needed.

**Fix**: Move the scope summary into the header, collapse optional prompt editors after save, and let the result pane own the limited scroll area.

**Prevention**: Keep AI dialogs compact and use the header for the high-level status. If a dialog needs multiple controls, ensure only the result region scrolls and the setup column remains visually light.

### Common Mistake: Reintroducing Native Dropdowns in New Panels

**Symptom**: A new settings or detail panel uses a native `select` or date input because it looks fast to wire up, but the popup behaves differently from the rest of the app.

**Cause**: The control was added in isolation and the author only styled the trigger, not the popup itself. In this project, dense panels are common, so a native popup often fails once it sits inside `overflow-hidden` or fixed-height containers.

**Fix**: Reuse the custom dropdown pattern already used in project details and settings panels. Make the popup a local floating layer with shared tokens, a compact row height, and upward placement when needed.

**Prevention**: When adding a new dropdown-like control, ask whether the browser popup can be clipped or whether it needs to match the app's own surface. If the answer is yes, default to the shared floating pattern instead of a plain native input.

### Common Mistake: Leaving Orphaned Locale Keys After Replacing Copy

**Symptom**: A loading string disappears from the UI, but the old locale key still exists in both language blocks and slowly drifts out of sync with the actual template.

**Cause**: `as const` keeps locale keys aligned between languages, but it does not remove dead keys. When copy is replaced with skeleton UI, a modal shell, or another structural pattern, the old string reference drops out of the component while the locale entry stays behind.

**Fix**: Delete the unused key from both locales in the same change and confirm the template no longer references it.

**Prevention**: Whenever you replace a single-line visible string with structural UI, search the locale file for the old key and remove every occurrence before finishing the change.

### Common Mistake: End-Aligning a Horizontally Scrollable Toolbar

**Symptom**: A compact toolbar looks correctly right-aligned at its normal width, but its first buttons disappear into an unreachable negative overflow area when the viewport narrows.

**Cause**: Applying `justify-end` directly to an overflowing flex row positions excess content before the scroll origin. The browser can scroll toward the end of the row, but not backward into that negative start-side overflow.

**Fix**: Keep the outer dashboard toolbar non-scrollable with `overflow-x-clip`. Put `overflow-x-auto` only on the `min-w-0 flex-1` group region, and keep the intrinsic action region as a `w-max shrink-0` sibling. Use compact padding and gaps below `sm` instead of a fixed minimum row width.

```vue
<div class="overflow-x-clip px-3 sm:px-6">
	<div class="flex min-w-0 items-center gap-2 sm:gap-4">
		<div class="min-w-0 flex-1 overflow-x-auto"><!-- group chips --></div>
		<div class="w-max shrink-0"><!-- compact toolbar actions --></div>
	</div>
</div>
```

When an action region swaps between a button row and an absolute overlay such as search, do not hard-code the region width from one browser measurement. Keep the complete button row in normal flow with `w-max` so it owns the intrinsic region width, then place the alternate state with `absolute inset-0`. The hidden in-flow row may use opacity, `inert`, and `pointer-events-none`, but it must continue sizing the region.

```vue
<div class="relative h-8 w-max shrink-0">
	<div class="absolute inset-0"><!-- search overlay --></div>
	<div class="flex h-8 w-max items-center gap-2"><!-- sizing action row --></div>
</div>
```

Do not put `overflow-x-auto` on this fixed action region. A transformed hidden layer can also increase `scrollWidth` even though it is transparent; keep its translation toward existing interior space or explicitly clip it after confirming that controls and focus rings remain visible.

**Prevention**: Test the toolbar at normal, compact, and actual host-like dimensions. For uTools, include a narrow CSS viewport with `deviceScaleFactor: 1.25`. Assert that the action region and its sizing row have equal widths, `clientWidth === scrollWidth` for the action region and outer toolbar, first and last controls fit, and only the group region gains `scrollWidth > clientWidth` when chips are forced to overflow. At widths below the intrinsic action width, the outer toolbar may clip, but it must keep `scrollLeft === 0`, expose no scrollbar, and preserve geometry throughout search transitions.
