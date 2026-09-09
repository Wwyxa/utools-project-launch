export interface GitActivityRange {
  startDate: string;
  endDate: string;
}

export interface GitActivityHeatmapCell {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  inRange: boolean;
}

const localDate = (value: Date): string => {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseLocalDate = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return localDate(date) === value ? date : null;
};

export const rollingGitActivityRange = (endDate = localDate(new Date()), days = 365): GitActivityRange => {
  const end = parseLocalDate(endDate) || new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(1, Math.floor(days)) + 1);
  return { startDate: localDate(start), endDate: localDate(end) };
};

export const calendarYearGitActivityRange = (year: number): GitActivityRange => {
  const normalizedYear = Number.isInteger(year) && year >= 1 && year <= 9999 ? year : new Date().getFullYear();
  return {
    startDate: `${String(normalizedYear).padStart(4, "0")}-01-01`,
    endDate: `${String(normalizedYear).padStart(4, "0")}-12-31`,
  };
};

export const gitActivityHeatmapCells = (
  range: GitActivityRange,
  countsByDate: ReadonlyMap<string, number>,
): GitActivityHeatmapCell[] => {
  const start = parseLocalDate(range.startDate);
  const end = parseLocalDate(range.endDate);
  if (!start || !end || start > end) return [];

  const maxCount = Math.max(...countsByDate.values(), 0);
  const firstVisibleDate = new Date(start);
  firstVisibleDate.setDate(firstVisibleDate.getDate() - firstVisibleDate.getDay());
  const lastVisibleDate = new Date(end);
  lastVisibleDate.setDate(lastVisibleDate.getDate() + (6 - lastVisibleDate.getDay()));
  const cells: GitActivityHeatmapCell[] = [];

  for (const date = new Date(firstVisibleDate); date <= lastVisibleDate; date.setDate(date.getDate() + 1)) {
    const dateKey = localDate(date);
    const inRange = date >= start && date <= end;
    const count = inRange ? Math.max(0, countsByDate.get(dateKey) || 0) : 0;
    const level =
      count === 0 || maxCount === 0
        ? 0
        : (Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4))) as 1 | 2 | 3 | 4);
    cells.push({ date: dateKey, count, level, inRange });
  }

  return cells;
};

export const gitActivityHeatmapMonthStarts = (cells: readonly GitActivityHeatmapCell[]): (string | null)[] => {
  const monthStarts: (string | null)[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    const firstDay = cells[index];
    monthStarts.push(firstDay?.inRange && Number(firstDay.date.slice(8)) <= 7 ? firstDay.date : null);
  }
  return monthStarts;
};
