# vscode-git-graph Rendering Reference

## Source

- User-provided repository: https://github.com/mhutchie/vscode-git-graph
- Smart-search command used:
  `smart-search search "mhutchie vscode-git-graph repository graph rendering lanes TypeScript source GitHub" --validation balanced --extra-sources 2 --format json --output C:\tmp\smart-search-evidence\vscode-git-graph-rendering-search.json`

## Relevant Findings

- Git Graph's rendering is centered around logical vertices and branches rather than isolated per-row drawing.
- Its key implementation is reported around `web/graph.ts`, with `Vertex`, `Branch`, and `Graph` classes.
- The important transferable idea is to compute lane/column positions and branch paths first, then render the graph as SVG paths.
- Branches track line segments across multiple commits; commits are vertices located on a lane and row.
- Lane allocation reuses columns when possible and tries to minimize overlaps/crossings.
- Rendering uses a grid: lane spacing on the x-axis and commit order on the y-axis.
- Branch lines can be angular or curved. Curved SVG paths make merge/split transitions easier to follow.

## Application To This Project

- Do not copy Git Graph source. Implement a smaller project-local lane model using the existing `ProjectGitCommitSummary.parents` data.
- Prefer a computed graph layout in `GitTab.vue` that produces:
  - rows with stable lane positions;
  - per-lane vertical continuity;
  - path segments for parent connections;
  - node coordinates for commit dots.
- Render with SVG paths in the current Git panel. The visual goal is continuous branch flow like the reference screenshot, while preserving the compact project UI.
- Keep existing click, selection, tooltip, refs, and load-more behavior.

## Constraints

- No new dependency is needed.
- The app currently receives short commit hashes and short parent hashes from `git log`, so parent matching should use the provided strings directly.
- Filtered views may hide parents; hidden parent connections should degrade gracefully instead of drawing misleading long jumps.
