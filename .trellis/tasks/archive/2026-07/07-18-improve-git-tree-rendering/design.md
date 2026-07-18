# Technical Design: Git Tree Multi-Branch References

## Scope

This task changes only `src/components/project/GitTab.vue`. It preserves the existing Git snapshot, Pinia flow, shared SVG graph layer, lane layout, and all Git write operations.

The implementation classifies the already available `git log --decorate=short` refs for presentation. It does not calculate branch divergence or change the preload/type bridge contract.

## Data Flow

```text
ProjectGitSnapshot.commits[].refs + snapshot.branch + snapshot.branches
  -> refsForCommit(raw decorate text)
  -> local ref parsing and classification
  -> { kind, displayName, className, icon, isHead }
  -> commit row badges, tooltip badges, and current-HEAD graph-node styling
```

`graphLayout` continues to use commit parent hashes and the checked-out branch to prioritize the active branch in lane zero. Ref classification augments the visual metadata only; it must not add or remove graph edges.

## Ref Presentation Model

Keep the small visual-only union and helper functions local to `GitTab.vue`, because no other component consumes this representation.

Classification uses this strict precedence:

1. Exact `HEAD` or `HEAD -> <branch>`: current HEAD. Strip the `HEAD ->` prefix only for the compact visible label.
2. `tag: <name>`: tag.
3. Remote ref prefixes already emitted by Git, including `origin/`, `upstream/`, `remote/`, and `remotes/<name>/`.
4. Local branch matching `snapshot.branches`; `main` and `master` use the primary-local variant, all other names use the local-branch variant.
5. Unknown decorate text: retain a neutral fallback without guessing a branch type.

The presentation maps types to existing Lucide icons and semantic design tokens:

| Ref kind      | Icon        | Intent                                             |
| ------------- | ----------- | -------------------------------------------------- |
| current HEAD  | `CircleDot` | primary focus at the checked-out tip               |
| primary local | `GitBranch` | stable mainline reference                          |
| local branch  | `GitBranch` | clearly distinct non-main local branch             |
| remote        | `Cloud`     | remote-tracking reference, including `remote/HEAD` |
| tag           | `Tag`       | immutable version marker                           |
| unknown       | none        | readable neutral fallback                          |

The badge helper is the sole source of the display label, icon, and Tailwind class list for both the dense commit row and its tooltip. Its title and accessible text keep the unmodified ref value where useful for inspection.

## Current-HEAD Correctness

Replace the loose `refs?.includes("HEAD")` check with a shared strict ref predicate. Only an exact `HEAD` or a ref beginning `HEAD ->` identifies the current commit.

This prevents an old `remote/HEAD` ref from receiving the larger outlined current-HEAD graph node. That ref remains a remote badge on its historical commit, which makes an out-of-date remote tip visually legible without asserting an undefined numeric comparison.

## Layout and Compatibility

- Retain the shared SVG's fixed pixel row coordinates, actual lane-span width, loaded-window clipping, and fan-out/fan-in behavior.
- Keep ref badges in the existing wrapping message metadata region. Each badge uses a fixed icon/text gap, `min-w-0`, truncation, and compact line height so dense rows and narrow panels do not overlap.
- Preserve row click, checkbox selection, hash copy, delayed tooltip, context-menu branch checkout, filter, load-more, and expanded-file vertical offsets.
- In detached HEAD mode, a bare `HEAD` still receives the current-HEAD presentation. In browser fallback or repositories without local branch data, unknown refs degrade to the neutral variant.

## Risk and Rollback

- Git decorate strings can contain unusual symbolic refs. Parsing stays prefix- and exact-match based; unrecognized values remain visible rather than being discarded.
- A shared presentation helper avoids divergent row/tooltip style updates.
- The change is source-only and can be rolled back by reverting the `GitTab.vue` ref-presentation helper and template bindings. No storage, bridge, or Git command migration exists.

## Verification

- Inspect a current `HEAD -> master`, a historical `remote/master, remote/HEAD`, a non-main local branch such as `tiny-card`, and tags when available.
- Switch among local branches in a real repository and confirm lane-zero focus follows only the checked-out branch.
- Run `npm run type-check` and `npm run build`.
- Inspect normal and narrow Git panel widths for badge clipping, graph-node alignment, horizontal scrolling, tooltip consistency, and preserved interactions.
