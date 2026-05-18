# Component Guidelines

> How components are built in this project.

---

## Overview

Components use `<script setup lang="ts">`, the Composition API, Tailwind utility classes, and `lucide-vue-next` icons. Most components are self-contained and domain-specific instead of deeply generic.

The current pattern is:

- define props with TypeScript generics
- keep shared state in the Pinia store when multiple views need it
- use `cn` from `src/lib/utils.ts` for conditional classes
- compose feature components from smaller tab or panel components

---

## Component Structure

Typical component shape:

```vue
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "../../store/useStore";

const props = defineProps<{ projectId: string }>();
</script>

<template>
  <!-- semantic markup, Tailwind classes, icon buttons, and feature panels -->
</template>
```

The project already follows this pattern in `src/components/project/ProjectDetails.vue`, `src/components/project/MemoTab.vue`, and `src/components/terminal/Terminal.vue`.

---

## Props Conventions

Use a typed `defineProps` declaration and prefer imported shared interfaces for domain data.

Examples already in the repo:

```ts
const props = defineProps<{
  project: Project;
}>();
```

Use `defineEmits` for explicit child-to-parent events. `ProjectCard.vue` emits `select` with a project id instead of mutating parent state directly.

---

## Styling Patterns

Styling is Tailwind-first.

- use utility classes in the template for layout, spacing, color, and state
- use semantic design tokens from `src/index.css` instead of ad hoc colors when possible
- use scoped CSS only for small transition effects that are awkward in utility classes, such as the fade transition in `src/App.vue`
- use the `cn` helper when conditional class merging is clearer than inline ternaries

Example: `src/components/layout/Sidebar.vue` and `src/components/dashboard/ProjectCard.vue` both rely on semantic color tokens and utility classes rather than local CSS files.

---

## Accessibility

Semantic elements are preferred: buttons for actions, inputs for search and editing, labels for checkboxes, and headings for section structure.

Current UI already uses those patterns in places like `src/components/layout/TopBar.vue` and `src/components/project/MemoTab.vue`. When adding icon-only controls, give them an accessible name instead of relying on the icon itself.

---

## Common Mistakes

- Putting shared project state in multiple components instead of the store
- Introducing an extra abstraction for a one-off panel
- Using raw SVGs when the same icon already exists in `lucide-vue-next`
- Adding local CSS files for patterns already covered by Tailwind and theme tokens
- Leaving icon-only actions without an accessible name
