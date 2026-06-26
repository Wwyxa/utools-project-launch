# Tiny Card Style for Simple Projects

## Background

Some projects in the dashboard are just configured for launching (e.g., a static HTML page, a compiled EXE, a simple script). These projects don't need the full card treatment — no description, no path, no scripts row, no footer action bar. A compact "tiny" card style reduces visual noise and saves vertical space.

## Requirements

### R1: Card Style Field

- Add `cardStyle: 'default' | 'tiny'` to the `Project` data model.
- Default value: `'default'` (backward compatible — existing projects keep their full card).
- The field is user-selectable in the project create/edit form.

### R2: Tiny Card Visual Layout

- **Single-row layout**: icon + project name + status indicator (running/error badge) on one line.
- No description, no path, no scripts row, no footer (time/action bar).
- Same grid width as default cards (`minmax(15.5rem, 1fr)`), but significantly shorter height.
- Retains the left-edge status bar (running green / error red).
- Hover state, drag-sort, quick-link button, and click-to-select behavior remain identical to default cards.
- Action buttons (terminal, editor, folder, edit, delete) appear on hover in a compact inline row at the right side of the single line, replacing the quick-link button area.

### R3: Form Integration

- Add a "Card Style" selector in the project create/edit form (ProjectFormModal).
- Two options: "Default" (标准) and "Tiny" (精简).
- Placed in the first section grid, after the name/path row.

### R4: Persistence

- `cardStyle` must round-trip through all persistence boundaries:
  - `Project` ↔ `ProjectFormValue` (formFromProject / saveProjectForm)
  - `toPersistedProject` (store persistence)
  - `toStoredProject` (uTools preload persistence)
- Missing `cardStyle` in legacy data → hydrate as `'default'`.

### R5: i18n

- Add labels for both zh-CN and en-US locales.

## Acceptance Criteria

1. A project with `cardStyle: 'tiny'` renders as a single-row compact card on the dashboard.
2. A project with `cardStyle: 'default'` (or missing field) renders with the existing full card layout.
3. The card style selector appears in the create/edit form and persists correctly.
4. After restart (uTools or browser), the card style is preserved.
5. Existing projects without `cardStyle` display as `'default'` (no visual change).
6. Build passes without errors.

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
