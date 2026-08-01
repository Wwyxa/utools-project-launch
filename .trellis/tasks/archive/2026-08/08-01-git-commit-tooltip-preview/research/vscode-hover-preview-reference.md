# VS Code Source Control And Commit Preview Reference

## Evidence Source

The user supplied a VS Code Git graph screenshot, reported testing commits with different message lengths and content volumes, and selected a VS Code-style source-control layout for this application. This note records only the observable reference behavior and the agreed product adaptation.

## Observable Reference Behavior

- Source-control commands, changes, and commit history belong to a compact left-side work area, while file content and diff review use the wider right-side editor area.
- Dense source-control groups use short collapsible title rows with icon actions aligned to the far right.
- The Git graph list remains unobscured while the hover card occupies adjacent application content space.
- The card keeps a stable horizontal position at the graph-panel boundary instead of following the pointer or each message's text bounds.
- The active commit row and card are associated vertically; the reference card's edge marker aligns near the active row center.
- Card width and height vary with commit content instead of using one fixed rectangle.
- Moving through different commit rows while the card is already visible updates the preview directly rather than paying the initial hover delay for every row.
- The initial delay still prevents accidental cards while the pointer merely passes across the graph.

## Agreed Application Layout

The application will adopt the same directional relationship instead of mirroring it:

- left pane contains collapsible Changes and Commit Tree sections;
- Changes contains the commit composer plus direct, visually weaker staged/unstaged secondary collapsible rows;
- right pane is always file review and has no Commit Tree / Review mode header;
- commit rows omit checkbox and hash columns and use Ctrl/Cmd click for multi-selection;
- card always appears on the commit tree's right;
- card left edge anchors to the commit-tree right boundary;
- content-fit width and height constrained by the application viewport;
- vertical center aligned to the active row, then minimally clamped at top or bottom;
- whole-row hover target and immediate replacement during an open hover session.

The manual load-more button and graph top/bottom controls are removed. A stable bottom sentinel automatically requests one existing pagination page per intersection entry without row insertion animation or recursive history loading.

The goal is behavioral similarity, not pixel-level reproduction of VS Code styling.
