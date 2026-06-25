/**
 * 时间格式化工具。
 *
 * 供 Dashboard 概览带与 ProjectCard 共用，避免重复实现。
 * 文案当前为中文，后续如需国际化再抽到 i18n。
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatAbsoluteTime(value?: string): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatRelativeTime(value?: string): string {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = Date.now() - date.getTime();
  const absDiff = Math.abs(diffMs);

  if (absDiff < MINUTE) {
    return diffMs >= 0 ? "刚刚" : "即将";
  }
  if (absDiff < HOUR) {
    const minutes = Math.max(1, Math.round(absDiff / MINUTE));
    return diffMs >= 0 ? `${minutes} 分钟前` : `${minutes} 分钟后`;
  }
  if (absDiff < DAY) {
    const hours = Math.max(1, Math.round(absDiff / HOUR));
    return diffMs >= 0 ? `${hours} 小时前` : `${hours} 小时后`;
  }
  if (absDiff < MONTH) {
    const days = Math.max(1, Math.round(absDiff / DAY));
    return diffMs >= 0 ? `${days} 天前` : `${days} 天后`;
  }
  if (absDiff < YEAR) {
    const months = Math.max(1, Math.round(absDiff / MONTH));
    return diffMs >= 0 ? `${months} 个月前` : `${months} 个月后`;
  }

  const years = Math.max(1, Math.round(absDiff / YEAR));
  return diffMs >= 0 ? `${years} 年前` : `${years} 年后`;
}
