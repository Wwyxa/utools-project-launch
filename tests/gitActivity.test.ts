import { describe, expect, it } from "vitest";
import {
  currentYearGitActivityRange,
  gitActivityComparison,
  gitActivityDateInTimeZone,
  gitActivityHeatmapCells,
  gitActivityStreaks,
  parseConventionalCommit,
  previousGitActivityRange,
  rollingGitActivityRange,
} from "../src/lib/gitActivity";

describe("Git activity heatmap helpers", () => {
  it("uses the selected time zone for rolling-range day boundaries", () => {
    const instant = new Date("2026-09-09T10:30:00.000Z");
    expect(gitActivityDateInTimeZone(instant, "UTC")).toBe("2026-09-09");
    expect(gitActivityDateInTimeZone(instant, "Pacific/Kiritimati")).toBe("2026-09-10");
    expect(rollingGitActivityRange(gitActivityDateInTimeZone(instant, "Pacific/Kiritimati"))).toEqual({
      startDate: "2025-09-11",
      endDate: "2026-09-10",
    });
  });

  it("builds inclusive daily and previous ranges across month and year boundaries", () => {
    expect(rollingGitActivityRange("2026-01-03", 7)).toEqual({ startDate: "2025-12-28", endDate: "2026-01-03" });
    expect(currentYearGitActivityRange("2026-09-10")).toEqual({ startDate: "2026-01-01", endDate: "2026-09-10" });
    expect(previousGitActivityRange({ startDate: "2026-01-01", endDate: "2026-01-03" })).toEqual({
      startDate: "2025-12-29",
      endDate: "2025-12-31",
    });
  });

  it("does not manufacture a percentage when the previous period is zero", () => {
    expect(gitActivityComparison(3, 0)).toEqual({ difference: 3, percent: null });
    expect(gitActivityComparison(15, 10)).toEqual({ difference: 5, percent: 50 });
  });

  it("allows the current streak to continue from yesterday and limits the longest streak to the range", () => {
    const activeDates = new Set(["2026-08-31", "2026-09-01", "2026-09-07", "2026-09-08", "2026-09-09"]);
    expect(gitActivityStreaks({ startDate: "2026-09-01", endDate: "2026-09-10" }, activeDates, "2026-09-10")).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it("recognizes Conventional Commit scopes and breaking markers", () => {
    expect(parseConventionalCommit("feat(activity)!: add ranges")).toEqual({
      type: "feat",
      scope: "activity",
      breaking: true,
    });
    expect(parseConventionalCommit("Update activity view")).toEqual({ type: "other", breaking: false });
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
});
