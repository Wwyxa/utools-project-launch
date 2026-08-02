# Git 提交树与交互性能总体设计

## Boundary

父任务只拥有需求来源、子任务顺序、共享约束和最终集成验收，不直接修改产品代码。三个子任务在同一分支上顺序执行，每个子任务独立完成实现、检查和提交后，下一项才开始。

## Task Architecture

```text
Git CLI / filesystem
        |
        v
public/preload.js -- typed commits, refs, status and actions
        |
        v
ProjectBridge types/fallback
        |
        v
Pinia repository snapshots and mutation generations
        |
        v
Git page orchestration
  |-- pure graph/ref/file-tree modules
  |-- changes and commit composer
  |-- commit history and preview
  `-- diff review and AI dialogs
```

### Child 1: Graph And Refs

- Establish pure, tested graph and ref presentation contracts.
- Replace the unique-hash global lane model with ordered per-row input/output swimlanes that permit duplicate commit ids.
- Keep the list-level SVG but give each row its own graph width.
- Make dense rows and hover preview consume one structured ref model.

### Child 2: Measured Performance

- Add a standard-library benchmark/command recorder before optimization.
- Separate user-visible working-tree correctness from branch/ref/history/workspace inventory work.
- Reuse immutable tooltip details within a repository renderer session.
- Optimize history/ref work only when the baseline identifies it as material.

### Child 3: GitTab Decomposition And Polish

- Reuse child 1 pure modules and child 2 async/cache contracts.
- Move complete UI lifecycles into a minimal number of domain components.
- Keep canonical repository data and mutations in Pinia; keep visual/session state local.
- Consolidate Git control styles with semantic tokens and existing Lucide icons.

## Shared Contracts

- Full commit and parent hashes remain authoritative across preload, Store and graph layout.
- Structured `refNames` remains authoritative; legacy `refs` is presentation-only fallback.
- Repository `contextKey`, mutation versions and ref versions remain the stale-result boundary.
- The graph row height, row gap, expanded-file height and SVG y coordinates use one pixel model.
- `GitTab` keeps its public `project`, `open-file` and exposed refresh surface throughout the sequence.
- No child adds a runtime dependency unless planning is reopened with measured evidence.

## Compatibility And Rollback

- Each child is committed separately so the next child can be reverted without discarding earlier verified behavior.
- Pure modules are integrated only after focused tests pass; the old inline owner is removed in the same child to avoid dual behavior.
- Performance changes retain the full snapshot/manual refresh path as the authoritative recovery path.
- Component extraction is mechanical after behavior stabilizes; each extraction is validated before the next responsibility moves.

## Integration Acceptance

- The three-lane screenshot scenario renders correctly and compactly.
- Ref badges are ordered, grouped and complete in dense rows and preview.
- Tooltip, stage/unstage and history load baselines show no regression and explain measured gains.
- Git page behavior survives the final component split and compact theme/style checks.
