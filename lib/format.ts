const numberFormat = new Intl.NumberFormat('zh-CN');

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

/** 保留 1 位小数并向下取整，未完成时不会显示 100%。 */
export function formatPercent(learned: number, total: number): string {
  if (total <= 0) return '0%';
  const value = Math.floor((learned / total) * 1000) / 10;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** 服务端 ISO 时间按用户本地时区展示。 */
export function formatStudyTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `今天 ${time}`;
  if (days === 1) return `昨天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}
