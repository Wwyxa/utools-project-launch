# Cross-Layer Changes

The usual path is component -> Pinia -> ProjectBridge adapter -> preload;
delegated processes/automation may continue into the Go service.

Before editing a boundary, identify its input/output, validation owner, failure
result, and identity needed to reject stale work. Keep types, real preload,
browser fallback, and Store consumers aligned.

- For persistence, state the required survival boundary: remount, plugin reopen,
  uTools restart, or device restart. Recreate the relevant runtime in tests and
  retain only the intended durable storage. See
  [Storage Guidelines](../backend/database-guidelines.md).
- For concurrent writes, apply the intended mutation to fresh state and test a
  conflict. A newer revision does not make an old full snapshot safe to write.
- For replayed events, use stable identities and an explicit initial baseline;
  presentation-history retention must not decide whether a side effect is new.
- For framework event handlers, call actions explicitly when their first argument
  is domain input rather than a UI event.
- For host capabilities, use the repository's uTools reference documents and
  actual preload behavior. Local browser/Node versions do not establish host
  support. Check platform-specific command/shim paths when process behavior changes.

Keep detailed design and investigation in task records. Specs should summarize
the lasting contract once, in the layer that owns it.
