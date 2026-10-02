export function getWeekMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diff);
  return d;
}

export function getWeekIndex(date: Date): number | null {
  const now = new Date();
  const thisMonday = getWeekMonday(now);
  const targetMonday = getWeekMonday(date);
  const diffMs = targetMonday.getTime() - thisMonday.getTime();
  const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  if (diffWeeks < 0 || diffWeeks > 3) return null;
  return diffWeeks;
}

export function getForecastWeekLabels(): string[] {
  const monday = getWeekMonday(new Date());
  const labels: string[] = ['今週'];
  for (let i = 1; i < 4; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i * 7);
    labels.push(`${d.getMonth() + 1}/${d.getDate()}週`);
  }
  return labels;
}
