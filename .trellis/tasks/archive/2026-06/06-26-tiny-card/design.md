# Design: Tiny Card Style

## Scope

Add `cardStyle` metadata to `Project` and render a compact single-row card variant on the dashboard.

## Data Flow

```
User selects cardStyle in form
  → ProjectFormValue.cardStyle
  → saveProjectForm() builds Project with cardStyle
  → toPersistedProject() preserves cardStyle
  → toStoredProject() preserves cardStyle (preload)
  → Hydration reads cardStyle, defaults to 'default'
  → ProjectCard.vue reads project.cardStyle to branch template
```

## Changes by File

### `src/types.ts`
- Add `export type ProjectCardStyle = 'default' | 'tiny';`
- Add `cardStyle?: ProjectCardStyle` to `Project` interface
- Add `cardStyle: ProjectCardStyle` to `ProjectFormValue` interface

### `src/store/useStore.ts`
- `createBlankProjectForm()`: add `cardStyle: 'default'`
- `formFromProject()`: map `cardStyle: project.cardStyle || 'default'`
- `toPersistedProject()`: include `cardStyle: project.cardStyle || 'default'`
- `saveProjectForm()`: pass `cardStyle: payload.cardStyle` into the project object

### `public/preload.js`
- `toStoredProject()`: include `cardStyle: project.cardStyle || 'default'`

### `src/components/dashboard/ProjectCard.vue`
- Add `isTiny` computed: `props.project.cardStyle === 'tiny'`
- Template: wrap existing full card in `v-if="!isTiny"`, add `v-else` tiny card block
- Tiny card: single flex row with icon, name, running/error badge, and hover action buttons
- Reduce outer padding from `p-3 min-h-36` to `py-2 px-3` for tiny mode

### `src/components/project/ProjectFormModal.vue`
- Add card style selector (two-button toggle) in the first grid section

### `src/lib/i18n.ts`
- zh-CN `modal`: `cardStyle: "卡片样式"`, `cardStyleDefault: "标准"`, `cardStyleTiny: "精简"`
- en-US `modal`: `cardStyle: "Card Style"`, `cardStyleDefault: "Default"`, `cardStyleTiny: "Tiny"`

## Compatibility

- Legacy projects without `cardStyle` → hydrate as `'default'` → no visual change
- No schema version bump needed; optional field with safe default
