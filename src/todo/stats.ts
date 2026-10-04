import { categories, type Snapshot } from './schemas.js';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function dateKey(value: Date): string {
  const parts = formatter.formatToParts(value);
  return ['year', 'month', 'day']
    .map((kind) => parts.find((p) => p.type === kind)!.value)
    .join('-');
}
const round = (value: number) => Math.round(value * 10) / 10;
export function summarize(data: Snapshot, days: number, now = new Date()) {
  const today = dateKey(now);
  const anchor = new Date(`${today}T00:00:00+08:00`);
  const start = new Date(anchor.getTime() - (days - 1) * 86400000);
  const end = new Date(anchor.getTime() + 86400000);
  const inRange = (value: string) =>
    new Date(value) >= start && new Date(value) < end;
  const sessions = data.sessions.filter((s) => inRange(s.completedAt));
  return {
    sessions,
    completed: data.tasks.filter(
      (t) => t.completedAt !== null && inRange(t.completedAt),
    ).length,
    minutes: round(sessions.reduce((sum, s) => sum + s.durationMinutes, 0)),
    bars: Array.from({ length: days }, (_, index) => {
      const key = dateKey(new Date(start.getTime() + index * 86400000));
      const [, month, day] = key.split('-');
      return {
        key,
        label: `${Number(month)}/${Number(day)}`,
        minutes: round(
          sessions
            .filter((s) => dateKey(new Date(s.completedAt)) === key)
            .reduce((sum, s) => sum + s.durationMinutes, 0),
        ),
      };
    }),
    categories: categories.map((category) => ({
      category,
      minutes: round(
        sessions
          .filter((s) => s.category === category)
          .reduce((sum, s) => sum + s.durationMinutes, 0),
      ),
    })),
  };
}
