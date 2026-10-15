# Frontend Directory Structure

`src/App.vue` is the composition root and `src/main.ts` mounts the Vue app.
Organize new work by feature rather than by generic technical layers.

| Path                        | Ownership                                               |
| --------------------------- | ------------------------------------------------------- |
| `src/components/layout/`    | App shell, settings, top-level navigation               |
| `src/components/dashboard/` | Project overview and cards                              |
| `src/components/project/`   | Project detail tabs and Git/file views                  |
| `src/components/terminal/`  | Runtime output surface                                  |
| `src/components/common/`    | Reusable interaction primitives with multiple consumers |
| `src/store/`                | Pinia domain state and actions                          |
| `src/lib/`                  | Pure helpers and the typed ProjectBridge adapter        |
| `src/composables/`          | Stateful UI adapters with a real lifecycle boundary     |
| `src/types.ts`              | Shared domain and bridge contracts                      |
| `src/index.css`             | Theme tokens and global styles                          |

Keep feature state near its owning component. Add a shared component or
composable only when it has more than one meaningful consumer or owns setup and
cleanup that would otherwise be duplicated.

Tests live in the top-level `tests/` directory and import production modules
from `src/`; do not add source-adjacent test files.

Naming follows the existing Vue layout: PascalCase components, camelCase
TypeScript utilities, lowercase feature folders, and `useStore.ts` for Pinia.
