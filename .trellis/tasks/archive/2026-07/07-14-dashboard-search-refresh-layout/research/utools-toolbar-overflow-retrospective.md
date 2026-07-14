# Bug Analysis: uTools Default-Window Toolbar Overflow

## 1. Root Cause Category

- **Category**: D/E - Test Coverage Gap and Implicit Assumption
- **Specific Cause**: The action region was fixed to 22rem from a single browser measurement and made horizontally scrollable. uTools host font, scale, and subpixel rounding produced a slightly different intrinsic button-row width, so the action layer created a visible scrollbar. A hidden search layer translated toward the inline end also increased the region's `scrollWidth`.

## 2. Why Fixes Failed

1. **Fixed 28rem group region**: This treated the group area as the stable layout anchor, contrary to the intended action-first sizing contract.
2. **Fixed 22rem action region**: The browser measurement was treated as a cross-host constant. The action layer's `overflow-x-auto` hid the sizing mismatch during wide-browser checks but exposed a scrollbar in uTools.
3. **640px-only host approximation**: The check covered CSS width but not the narrower usable host width, `deviceScaleFactor: 1.25`, intrinsic content width, or scrollbar ownership.

## 3. Prevention Mechanisms

| Priority | Mechanism     | Specific Action                                                                                                             | Status |
| -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| P0       | Architecture  | Keep the default action row in flow and let `w-max` determine the fixed action-region width; overlay search absolutely.     | DONE   |
| P0       | Test coverage | Assert geometry and `clientWidth/scrollWidth` at 512 CSS px with DPR 1.25, plus 640, 1280, and extreme 320 widths.          | DONE   |
| P0       | Test coverage | Force group-chip overflow and assert that only the group region owns a visible 4px scrollbar.                               | DONE   |
| P1       | Code review   | Reject hard-coded toolbar widths derived from a single browser measurement when controls can size the region intrinsically. | DONE   |

## 4. Systematic Expansion

- **Similar Issues**: Compact headers that swap action rows for search/filter inputs can reproduce the same bug when a hidden absolute layer is transformed toward the scroll end.
- **Design Improvement**: Stable controls should remain the sizing source while alternate animated states are overlays.
- **Process Improvement**: Browser layout checks for uTools-facing UI must include host-like CSS width and DPR, not viewport width alone.

## 5. Knowledge Capture

- [x] Updated `.trellis/spec/frontend/quality-guidelines.md` with intrinsic sizing and host-DPR checks.
- [x] Extended the task browser regression script with host-like geometry, scrollbar ownership, and transition-state assertions.
- [x] Recorded the root cause and failed assumptions in this task research note.
- [ ] Commit the code, test, task, and spec updates after user authorization.
