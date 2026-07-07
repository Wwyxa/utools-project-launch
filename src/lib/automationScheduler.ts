import type { ProjectAutomationDailyPlan, ProjectAutomationPlanEntry, ProjectAutomationSchedule } from "../types";

const minutesPerDay = 24 * 60;

export interface AutomationScheduleValidationResult {
  valid: boolean;
  message: string;
}

export function dateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

export function minutesToTime(value: number): string {
  const normalized = Math.max(0, Math.min(minutesPerDay - 1, Math.floor(value)));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${hours}`.padStart(2, "0") + ":" + `${minutes}`.padStart(2, "0");
}

export function plannedDateTime(date: string, minutes: number): string {
  return `${date}T${minutesToTime(minutes)}:00`;
}

function seededRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return () => {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createPlanEntry(taskId: string, index: number, plannedAt: string): ProjectAutomationPlanEntry {
  return {
    id: `${taskId}-${plannedAt}-${index}`,
    plannedAt,
    status: "pending",
  };
}

export function validateAutomationSchedule(schedule: ProjectAutomationSchedule): AutomationScheduleValidationResult {
  if (!Number.isInteger(schedule.dailyCount) || schedule.dailyCount < 1) {
    return { valid: false, message: "每日次数至少为 1。" };
  }

  if (schedule.type === "fixed") {
    const startMinutes = parseTimeToMinutes(schedule.startTime);
    if (startMinutes === null) {
      return { valid: false, message: "固定时间格式无效。" };
    }
    if (!Number.isInteger(schedule.intervalMinutes) || schedule.intervalMinutes < 1) {
      return { valid: false, message: "固定间隔至少为 1 分钟。" };
    }
    const lastMinutes = startMinutes + (schedule.dailyCount - 1) * schedule.intervalMinutes;
    if (lastMinutes >= minutesPerDay) {
      return { valid: false, message: "固定计划超出当天范围，请减少次数或间隔。" };
    }
    return { valid: true, message: "" };
  }

  const windowStart = parseTimeToMinutes(schedule.windowStart);
  const windowEnd = parseTimeToMinutes(schedule.windowEnd);
  if (windowStart === null || windowEnd === null || windowEnd <= windowStart) {
    return { valid: false, message: "随机时间窗口无效。" };
  }
  if (!Number.isInteger(schedule.minIntervalMinutes) || schedule.minIntervalMinutes < 0) {
    return { valid: false, message: "最小随机间隔不能小于 0。" };
  }
  if (!Number.isInteger(schedule.maxIntervalMinutes) || schedule.maxIntervalMinutes < schedule.minIntervalMinutes) {
    return { valid: false, message: "最大随机间隔不能小于最小间隔。" };
  }
  const span = windowEnd - windowStart;
  const requiredSpan = (schedule.dailyCount - 1) * schedule.minIntervalMinutes;
  if (requiredSpan > span) {
    return { valid: false, message: "随机窗口无法容纳当前次数和最小间隔。" };
  }

  return { valid: true, message: "" };
}

export function generateFixedDailyPlan(
  taskId: string,
  schedule: Extract<ProjectAutomationSchedule, { type: "fixed" }>,
  date: string,
): ProjectAutomationDailyPlan {
  const startMinutes = parseTimeToMinutes(schedule.startTime) ?? 0;
  const entries = Array.from({ length: Math.max(0, schedule.dailyCount) }, (_, index) =>
    createPlanEntry(taskId, index, plannedDateTime(date, startMinutes + index * schedule.intervalMinutes)),
  );
  return { date, entries };
}

export function generateRandomDailyPlan(
  taskId: string,
  schedule: Extract<ProjectAutomationSchedule, { type: "random" }>,
  date: string,
): ProjectAutomationDailyPlan {
  const startMinutes = parseTimeToMinutes(schedule.windowStart) ?? 0;
  const endMinutes = parseTimeToMinutes(schedule.windowEnd) ?? startMinutes;
  const count = Math.max(0, schedule.dailyCount);
  if (count === 0) {
    return { date, entries: [] };
  }
  if (count === 1) {
    const random = seededRandom(`${taskId}:${date}:0`);
    const minute = startMinutes + Math.floor(random() * Math.max(1, endMinutes - startMinutes + 1));
    return { date, entries: [createPlanEntry(taskId, 0, plannedDateTime(date, minute))] };
  }

  const random = seededRandom(`${taskId}:${date}:${count}`);
  const span = endMinutes - startMinutes;
  const minTotalGap = (count - 1) * schedule.minIntervalMinutes;
  const maxTotalGap = (count - 1) * schedule.maxIntervalMinutes;
  const totalGap = minTotalGap + Math.floor(random() * (Math.min(maxTotalGap, span) - minTotalGap + 1));
  let remainingExtra = totalGap - minTotalGap;
  const gaps: number[] = [];

  for (let index = 0; index < count - 1; index += 1) {
    const remainingGaps = count - 1 - index;
    const maxExtraForGap = Math.min(schedule.maxIntervalMinutes - schedule.minIntervalMinutes, remainingExtra);
    const reservedExtra = Math.max(
      0,
      remainingExtra - (remainingGaps - 1) * (schedule.maxIntervalMinutes - schedule.minIntervalMinutes),
    );
    const extra = reservedExtra + Math.floor(random() * (maxExtraForGap - reservedExtra + 1));
    gaps.push(schedule.minIntervalMinutes + extra);
    remainingExtra -= extra;
  }

  const startOffset = Math.floor(random() * (span - totalGap + 1));
  const minutes = [startMinutes + startOffset];
  gaps.forEach((gap) => {
    minutes.push(minutes[minutes.length - 1] + gap);
  });

  return {
    date,
    entries: minutes.map((minutesValue, index) => createPlanEntry(taskId, index, plannedDateTime(date, minutesValue))),
  };
}

export function generateAutomationDailyPlan(
  taskId: string,
  schedule: ProjectAutomationSchedule,
  date = dateKey(),
): ProjectAutomationDailyPlan {
  return schedule.type === "fixed"
    ? generateFixedDailyPlan(taskId, schedule, date)
    : generateRandomDailyPlan(taskId, schedule, date);
}

export function getNextAutomationPlanEntry(
  plans: ProjectAutomationDailyPlan[],
  now = new Date(),
): ProjectAutomationPlanEntry | null {
  const nowTime = now.getTime();
  return (
    plans
      .flatMap((plan) => plan.entries)
      .filter((entry) => entry.status === "pending" && new Date(entry.plannedAt).getTime() > nowTime)
      .sort((left, right) => new Date(left.plannedAt).getTime() - new Date(right.plannedAt).getTime())[0] || null
  );
}
