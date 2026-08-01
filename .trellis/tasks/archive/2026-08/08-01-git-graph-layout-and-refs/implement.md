# Git 提交图布局与引用徽标执行计划

## Ordered Checklist

1. Establish the graph test surface.
   - Add `src/lib/gitCommitGraph.test.ts` with linear and three-lane fixtures.
   - Add the smallest typed module shell and run only this test; the three-lane assertion must fail before the algorithm is completed.
2. Implement per-row swimlane transitions.
   - Preserve duplicate ids and deterministic colors.
   - Add fork, merge, octopus, root, page-boundary and filtered-window assertions one fixture at a time.
   - Run the focused graph test after each local repair.
3. Add row-local segment and geometry output.
   - Cover per-row width, canvas max width, parent index and multiple expanded-row offsets.
   - Keep constants in one module and avoid DOM/theme imports.
4. Establish structured ref tests and implement `gitCommitRefs.ts`.
   - Cover HEAD/local/remote/tag order, upstream priority, duplicate suppression, grouped members and full hover expansion.
   - Preserve structured comma names and legacy fallback behavior.
5. Integrate pure modules into `GitTab.vue`.
   - Replace inline graph/ref calculations.
   - Render the shared SVG from semantic segments.
   - Use each row's graph width for text and expanded-detail offsets.
6. Run focused and boundary validation.
   - Verify selection, expansion, context menu, preview, filtering, pagination and horizontal scrolling manually.
   - Compare one-lane and three-lane content starts in desktop and narrow layouts.
7. Run final child checks and Trellis review.

## Validation Commands

```powershell
npx vitest run src/lib/gitCommitGraph.test.ts src/lib/gitCommitRefs.test.ts
npm run validate:git-commits
npm run type-check
npm run build
```

## Risk And Rollback

- Highest risk: path geometry can be visually wrong while lane arrays are correct. Keep semantic segment tests separate from browser geometry checks.
- Filtering deliberately changes the visible topology boundary; no off-window node may be synthesized to make the graph look continuous.
- Roll back the `GitTab.vue` integration independently if necessary; retain pure tests as the expected contract.
