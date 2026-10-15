# Composable Guidelines

Use Vue Composition API primitives directly when state belongs to one view.
Create a `useXxx` composable only when it owns a meaningful lifecycle or adapts
state for presentation, such as `useResizableSplit` or
`useGlobalActionStatus`.

- Keep shared domain and runtime state in Pinia. A composable must not hide Store
  mutations or become a second source of truth.
- Return typed values and actions. Register browser/renderer listeners in the
  composable and remove them on unmount or context replacement.
- Async adapters expose loading/error or settled state and reject stale results
  when the project, repository context, or request generation changes.
- Keep one-off refs, panel toggles, draft text, and hover state in the component
  that owns the interaction.

For host operations, components call Store actions; the Store calls
`src/lib/projectBridge.ts`. There is no separate client-server fetching layer.
