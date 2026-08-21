import { describe, expect, it } from "vitest";
import { generateRandomDailyPlan, parseTimeToMinutes } from "../src/lib/automationScheduler";
import type { ProjectAutomationSchedule } from "../src/types";

function plannedMinutes(plannedAt: string): number {
  const time = plannedAt.slice(11, 16);
  return parseTimeToMinutes(time) ?? -1;
}

describe("automation schedule vectors", () => {
  it.each([
    [
      "three entries",
      "vector-task",
      {
        type: "random",
        windowStart: "08:00",
        windowEnd: "18:00",
        dailyCount: 3,
        minIntervalMinutes: 30,
        maxIntervalMinutes: 120,
      },
      [513, 553, 656],
    ],
    [
      "single entry",
      "vector-task",
      {
        type: "random",
        windowStart: "00:00",
        windowEnd: "23:59",
        dailyCount: 1,
        minIntervalMinutes: 0,
        maxIntervalMinutes: 0,
      },
      [227],
    ],
    [
      "tight window",
      "vector-task",
      {
        type: "random",
        windowStart: "09:00",
        windowEnd: "12:00",
        dailyCount: 4,
        minIntervalMinutes: 10,
        maxIntervalMinutes: 45,
      },
      [674, 690, 705, 718],
    ],
  ])("matches the canonical %s vector", (_name, taskId, schedule, expected) => {
    const plan = generateRandomDailyPlan(
      taskId,
      schedule as Extract<ProjectAutomationSchedule, { type: "random" }>,
      "2026-08-15",
    );
    expect(plan.entries.map((entry) => plannedMinutes(entry.plannedAt))).toEqual(expected);
  });
});
