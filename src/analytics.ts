export type AnalyticsWindow = { days: 7 | 30; from: number; to: number };
export type AnalyticsEventCount = { day: string; kind: string; count: number };
export type DailyAnalytics = {
  date: string;
  total: number;
  priceUp: number;
  priceDown: number;
  lifecycle: number;
  other: number;
};

export function analyticsWindow(requested: string | undefined, current: number): AnalyticsWindow {
  const days: 7 | 30 = requested === '30' ? 30 : 7;
  const today = Math.floor(current / 86400) * 86400;
  return { days, from: today - (days - 1) * 86400, to: current };
}

export function classifyEventKind(kind: string): 'priceUp' | 'priceDown' | 'lifecycle' | 'other' {
  if (kind === 'price.increased' || kind === 'image.price_increased') return 'priceUp';
  if (kind === 'price.decreased' || kind === 'image.price_decreased') return 'priceDown';
  if (['model.added', 'model.removed', 'model.restored', 'endpoint.added', 'endpoint.removed', 'endpoint.restored'].includes(kind)) return 'lifecycle';
  return 'other';
}

export function buildDailyAnalytics(rows: AnalyticsEventCount[], from: number, days: 7 | 30): DailyAnalytics[] {
  const result = Array.from({ length: days }, (_, index): DailyAnalytics => ({
    date: new Date((from + index * 86400) * 1000).toISOString().slice(0, 10),
    total: 0,
    priceUp: 0,
    priceDown: 0,
    lifecycle: 0,
    other: 0
  }));
  const byDate = new Map(result.map((day) => [day.date, day]));
  for (const row of rows) {
    const day = byDate.get(row.day);
    if (!day || !Number.isFinite(row.count) || row.count <= 0) continue;
    day.total += row.count;
    day[classifyEventKind(row.kind)] += row.count;
  }
  return result;
}
