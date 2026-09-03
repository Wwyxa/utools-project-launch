# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Frontend quality is enforced by the Vitest suite, TypeScript checks, the production build, and the current component conventions.

The repo currently exposes:

- `npm test` -> complete Vitest plugin test suite
- `npm run lint` -> `tsc --noEmit`
- `npm run build` -> Vite production build

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

- run `npm test`
- run `npm run lint`
- run `npm run build`
- run `node --check public/preload.js` when changing preload code
- for inline Git diff highlights, test a paired line with an insertion or deletion on only one side; the unchanged side must not suppress the other side's mark. Also cover indentation-only pairs and whitespace-only lines where one side is empty; changed spaces/tabs must receive character-level background highlights without replacing the source characters with visible glyphs.
- for unequal Git diff blocks, compute inline ranges across the complete old/new block before rendering rows. Formatting-only compression or expansion must leave shared code tokens such as `type`, `Boolean`, `default`, and `true` outside non-empty character ranges; only changed spaces, tabs, indentation, and line-break boundaries may receive whitespace-only marks. Real token replacements must remain highlighted.
- for Git diff hunk navigation, test three hunk headers that fit in one scrollport; next/previous must progress `1/3 -> 2/3 -> 3/3 -> 2/3` even when `scrollTop` remains unchanged. In a scrollable full-file diff, also verify that the final change block remains active at the bottom when it cannot align with the scrollport top. In unified and side-by-side layouts, calculate the target from the block and scroll-container rectangles; do not use `offsetTop` across a toolbar or Teleport boundary.
- keep the active Git diff block navigation-owned; scroll events and parent scroll-position synchronization must not recompute it, so its block-border highlighting survives manual scrolling.
- manually inspect the dashboard and project detail flows for layout overflow, broken tab switching, and clipped terminal output
- verify that normal readiness logs remain neutral/success-toned while real errors stay red
- for interactive hover previews in dense panels, verify the cold-open delay, immediate warm switching, tab switching/unmount cleanup, Markdown rendering, stable panel-edge anchoring, full viewport bounds, and cleanup after every layout-changing section collapse in a compact window

Keep tests focused on pure helpers, bridge contracts, store mutations, and other behavior that can be verified without a browser harness.

---

### Common Mistake: Coloring The Whole Changed Line As An Inline Difference

**Symptom**: A formatting-only diff makes unchanged code tokens look like inserted or deleted text.

**Cause**: Rows are paired by position, or the row-level addition/deletion foreground is mistaken for a character-level range.

**Fix**: Map the complete changed block first, render only precise whitespace/line-break ranges as saturated marks, and keep the row-level addition/deletion treatment to a light background. Preserve the original spaces and tabs in the source text.

**Prevention**: Assert both the model ranges and rendered DOM for a 4-to-1 and 1-to-4 formatting change in unified and side-by-side views; assert that real text replacements still produce marks.

## Code Review Checklist

- Props and events are typed
- New state lives in the right layer
- Icons, spacing, and colors follow the current design tokens
- The new UI still works without a backend
- No accidental use of `any` or duplicated domain models
- Floating UI is not clipped by parent overflow and does not jump far away from the trigger while hovering dense lists

### Common Mistake: Applying Overlay Scrollbars To Fixed Popup Shells

**Symptom**: A teleported popup uses a `fixed` utility but its computed position becomes `relative`, so page scrolling moves the popup away from its viewport-clamped coordinates.

**Cause**: The overlay scrollbar directive establishes positioning on its host element and overrides the popup shell's fixed positioning.

**Fix**: Keep the teleported shell responsible for fixed positioning and viewport clamping. Apply `v-overlay-scrollbar` to a nested height-constrained scrolling element instead.

```vue
<!-- Wrong: the scrollbar directive can override the fixed shell. -->
<div v-overlay-scrollbar class="fixed overflow-y-auto">...</div>

<!-- Correct: the outer shell remains fixed and the inner element scrolls. -->
<div class="fixed">
	<div v-overlay-scrollbar class="max-h-[calc(100vh-1rem)] overflow-y-auto">...</div>
</div>
```

**Prevention**: For each teleported popup, assert both `getComputedStyle(popup).position === "fixed"` and its settled bounding box against the viewport after the overlay scrollbar initializes.

### Common Mistake: Breaking A Split Pane's Flex Height Chain

**Symptom**: A side-by-side code or Diff pane leaves a large blank area below short content, and its supposedly scrollable columns grow only to their content height instead of filling the dialog.

**Cause**: An intermediate wrapper remains a block element. Its child has `flex-1`, but that property cannot consume vertical space until every parent in the height chain is a constrained Flex container.

**Fix**: Make the intermediate wrapper a `flex min-h-0 flex-1` container before giving its split child `flex-1`.

```vue
<!-- Wrong: the inner flex row is a normal block child. -->
<div class="min-h-0 flex-1 overflow-hidden">
	<div class="flex min-h-0 flex-1"><!-- panes --></div>
</div>

<!-- Correct: both levels participate in the constrained Flex chain. -->
<div class="flex min-h-0 flex-1 overflow-hidden">
	<div class="flex min-h-0 flex-1"><!-- panes --></div>
</div>
```

**Prevention**: In a compact and an expanded dialog, measure the intermediate wrapper and both scroll panes. Their client height must fill the available review area for both short and long diffs; horizontal scrolling must remain local to each pane.

### Common Mistake: Estimating A Side Preview's Size

**Symptom**: A side-aligned interactive preview initially looks aligned, then shifts, overlaps a list row, or clips at the viewport edge after Markdown, avatars, or asynchronous summary content loads.

**Cause**: Its vertical position is calculated from a fixed estimated height or pointer offset even though the card's rendered dimensions can change after it opens.

**Fix**: Anchor the horizontal edge to the owning panel rather than the pointer. Measure the teleported fixed shell after mount and observe it with `ResizeObserver`; center it on the active row using the measured height, then clamp it to the viewport.

```ts
const rowCenter = (rowRect.top + rowRect.bottom) / 2;
const popupHeight = popup.getBoundingClientRect().height;
const top = clamp(rowCenter - popupHeight / 2, viewportInset, viewportHeight - popupHeight - viewportInset);
```

**Prevention**: In a dense list, test short and long content, loading-to-loaded size changes, top/middle/bottom rows, a cold hover, adjacent warm switches, and pointer transfer into the interactive card.

### Common Mistake: Relying On Tailwind Dark Variants Without Verifying Them

**Symptom**: A `dark:*` utility is present, but the rendered text still uses the original opacity or muted color.

**Cause**: This renderer toggles a root `.dark` class but does not configure Tailwind's `dark` variant to match that class. A utility can compile without matching the actual theme state.

**Fix**: Put dark-only overrides in `src/index.css` under an explicit `.dark ...` selector and use the shared semantic token. Reuse `.dark-readable-meta` for compact metadata; keep same-role controls on the same base color instead of adding per-control classes for cosmetic differences.

**Prevention**: Check the computed style in a dark browser viewport for each new theme rule, especially placeholder and compact metadata text.

### Common Mistake: Relying on Native Popups Inside Dense Panels

**Symptom**: A `select` or `input[type=date]` looks styled, but its browser popup still appears in the default system style or opens beneath the trigger where it gets clipped by the surrounding panel.

**Cause**: The trigger element was themed, but the actual popup remained native. Nested overflow containers, fixed-height dialogs, and compact settings panes make the browser's default popup behavior a poor fit.

**Fix**: Replace the picker with a local custom floating menu or calendar when the control sits inside a dense panel or dialog. Keep the value in the same store field, but own the popup surface and its placement.

**Prevention**: When reviewing compact dialogs and settings panes, check the full interaction, not just the trigger styling. If the popup is part of a dense surface, verify clipping, placement, and scrollbar behavior in the browser.

### Common Mistake: Leaving Teleported Controls Open When Their Owner Collapses

**Symptom**: A panel closes with its local filter hidden, but a calendar or other Teleport-based popup remains visible in the viewport after keyboard interaction or a state-driven collapse.

**Cause**: The owner uses `v-show` or a separate `open` prop while the Teleport condition only depends on popup-local state. Pointer interactions can accidentally close the popup first, masking the missing lifecycle path.

**Fix**: Keep popup state local to its owning component and explicitly close the parent filter and child popup whenever the owner transitions to closed, as well as during context cleanup and unmount.

**Prevention**: Open the popup, then close the owner with mouse, Enter/Space, and a reactive state transition. Each path must remove the teleported surface from `body`.

### Common Mistake: Sizing Only the Collapsible Bar

**Symptom**: A dense section appears to be 32px or 28px high, but its title/toggle button has only text-line height. Keyboard focus and the click target occupy a narrow strip inside the visual bar.

**Cause**: The parent flex row receives the fixed height while its direct `button[aria-expanded]` is allowed to size to content. Global button resets can also remove the browser outline.

**Fix**: Stretch the direct toggle to its owning bar and give it the same semantic focus rule as adjacent action controls.

```css
:where(.git-section-bar, .git-subsection-bar) > button[aria-expanded] {
  height: 100%;
}

:where(.git-section-bar, .git-subsection-bar) > button[aria-expanded]:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}
```

**Prevention**: In browser checks, measure both the bar and the direct toggle. Assert 32px for primary and 28px for secondary headers, then use a keyboard-initiated focus interaction to verify the visible outline at normal and host-like widths.

### Common Mistake: Letting Layout Attributes Fall Through a Teleport Fragment

**Symptom**: Vue warns that non-prop attributes such as `class` cannot be inherited because a component renders a fragment or Teleport root. Parent layout constraints silently disappear from the visible panel.

**Cause**: A component with one visible root plus one or more `Teleport` siblings is a multi-root component. Vue cannot choose where to apply fallthrough attributes automatically.

**Fix**: Disable implicit inheritance and forward attributes to the component's canonical visible root.

```vue
<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>

<template>
  <section v-bind="$attrs" class="flex min-h-0 flex-col">
    <!-- Visible component content. -->
  </section>
  <Teleport to="body"><!-- Floating content. --></Teleport>
</template>
```

**Prevention**: When a reusable panel contains a `Teleport`, verify its parent-supplied `class`, `id`, and accessibility attributes appear on the visible root. Open the panel once in the browser and confirm the Vue fallthrough warning is absent.

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
