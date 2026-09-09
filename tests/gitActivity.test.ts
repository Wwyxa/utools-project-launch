import { describe, expect, it } from "vitest";
import {
  calendarYearGitActivityRange,
  gitActivityHeatmapCells,
  gitActivityHeatmapMonthStarts,
  rollingGitActivityRange,
} from "../src/lib/gitActivity";

describe("Git activity heatmap helpers", () => {
  it("builds an inclusive rolling 365-day range using local calendar dates", () => {
    expect(rollingGitActivityRange("2026-09-09")).toEqual({
      startDate: "2025-09-10",
      endDate: "2026-09-09",
    });
  });

  it("uses calendar-year boundaries without losing leap days", () => {
    expect(calendarYearGitActivityRange(2024)).toEqual({ startDate: "2024-01-01", endDate: "2024-12-31" });
  });

  it("pads the heatmap to full Sunday-start weeks and normalizes contribution levels", () => {
    const cells = gitActivityHeatmapCells(
      { startDate: "2026-02-03", endDate: "2026-02-10" },
      new Map([
        ["2026-02-03", 1],
        ["2026-02-05", 4],
      ]),
    );

    expect(cells).toHaveLength(14);
    expect(cells[0]).toMatchObject({ date: "2026-02-01", inRange: false, count: 0, level: 0 });
    expect(cells.find((cell) => cell.date === "2026-02-03")).toMatchObject({ count: 1, level: 1, inRange: true });
    expect(cells.find((cell) => cell.date === "2026-02-05")).toMatchObject({ count: 4, level: 4, inRange: true });
    expect(cells.at(-1)).toMatchObject({ date: "2026-02-14", inRange: false, count: 0, level: 0 });
  });

  it("aligns each month label with its first Sunday column", () => {
    const cells = gitActivityHeatmapCells(
      { startDate: "2026-07-01", endDate: "2026-09-09" },
      new Map([["2026-09-09", 1]]),
    );
    const monthStarts = gitActivityHeatmapMonthStarts(cells);
    const septemberCellIndex = cells.findIndex((cell) => cell.date === "2026-09-09");

    expect(monthStarts).toEqual([
      null,
      "2026-07-05",
      null,
      null,
      null,
      "2026-08-02",
      null,
      null,
      null,
      null,
      "2026-09-06",
    ]);
    expect(Math.floor(septemberCellIndex / 7)).toBe(monthStarts.indexOf("2026-09-06"));
  });
});
