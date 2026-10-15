# Frontend Guidelines

The frontend uses Vue 3, Pinia, TypeScript, and Vite. Host operations go through
`src/lib/projectBridge.ts` into the uTools preload bridge.

| Guide                                             | Scope                             |
| ------------------------------------------------- | --------------------------------- |
| [Directory Structure](./directory-structure.md)   | Module ownership                  |
| [Component Guidelines](./component-guidelines.md) | Components and styling            |
| [Hook Guidelines](./hook-guidelines.md)           | Composables and lifecycle         |
| [State Management](./state-management.md)         | Shared and local state            |
| [Quality Guidelines](./quality-guidelines.md)     | Frontend validation               |
| [Type Safety](./type-safety.md)                   | Shared types and bridge contracts |
