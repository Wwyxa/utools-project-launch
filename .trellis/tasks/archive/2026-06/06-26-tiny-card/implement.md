# Implement: Tiny Card Style

## Checklist

- [x] 1. `src/types.ts` — Add `ProjectCardStyle` type, add `cardStyle` to `Project` and `ProjectFormValue`
- [x] 2. `src/lib/i18n.ts` — Add zh-CN and en-US labels for card style selector
- [x] 3. `src/store/useStore.ts` — Update `createBlankProjectForm`, `formFromProject`, `toPersistedProject`, `saveProjectForm`
- [x] 4. `public/preload.js` — Update `toStoredProject` to include `cardStyle`
- [x] 5. `src/components/project/ProjectFormModal.vue` — Add card style selector UI
- [x] 6. `src/components/dashboard/ProjectCard.vue` — Add tiny card template branch
- [x] 7. Build verification — `npx vite build` passes

## Validation

- Create a new project with cardStyle "tiny" → dashboard shows compact single-row card
- Edit existing project to "tiny" → card switches to compact
- Restart app → card style preserved
- Legacy projects (no cardStyle field) → render as default
