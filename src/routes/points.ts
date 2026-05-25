import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';

type Bindings = Env;
type Variables = { userId: string; userEmail: string };

const points = new Hono<{ Bindings: Bindings; Variables: Variables }>();

points.use('*', authMiddleware);

function toLocalDateStr(isoUtc: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, dateStyle: 'short' }).format(new Date(isoUtc));
  } catch {
    return isoUtc.slice(0, 10);
  }
}

function todayLocal(timezone: string): string {
  return toLocalDateStr(new Date().toISOString(), timezone);
}

function getOffsetMinutes(tz: string): number {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    const local = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const offset = Math.round((local.getTime() - now.getTime()) / 60000);
    return Number.isFinite(offset) ? offset : 0;
  } catch {
    return 0;
  }
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

points.get('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const user = await db.prepare('SELECT timezone FROM users WHERE id = ?').bind(userId).first<{ timezone: string }>();
  const tz = user?.timezone ?? 'UTC';
  const today = todayLocal(tz);
  const offset = getOffsetMinutes(tz);
  const mod = `${offset >= 0 ? '+' : ''}${offset} minutes`;

  const weekStart = addDays(today, -6);
  const monthStart = addDays(today, -28);
  const yearStart = addDays(today, -365);
  const heatStart = addDays(today, -13);
  const streakCutoffDate = new Date(today + 'T12:00:00Z');
  streakCutoffDate.setUTCDate(streakCutoffDate.getUTCDate() - 399);
  const streakCutoff = toLocalDateStr(streakCutoffDate.toISOString(), tz);

  const [totalRes, activeDaysRes, streakRes, dayRes, weekRes, monthRes, yearRes, heatRes] = await db.batch([
    db.prepare(`SELECT COALESCE(SUM(points), 0) as total FROM entries WHERE user_id = ?`)
      .bind(userId),
    db.prepare(`SELECT COUNT(DISTINCT date(logged_at, '${mod}')) as days FROM entries WHERE user_id = ?`)
      .bind(userId),
    db.prepare(`SELECT DISTINCT date(logged_at, '${mod}') as d FROM entries WHERE user_id = ? AND date(logged_at, '${mod}') >= ? ORDER BY d DESC`)
      .bind(userId, streakCutoff),
    db.prepare(`SELECT CAST(strftime('%H', logged_at, '${mod}') AS INTEGER) as h, COALESCE(SUM(points), 0) as pts FROM entries WHERE user_id = ? AND date(logged_at, '${mod}') = ? GROUP BY h`)
      .bind(userId, today),
    db.prepare(`SELECT date(logged_at, '${mod}') as d, COALESCE(SUM(points), 0) as pts FROM entries WHERE user_id = ? AND date(logged_at, '${mod}') >= ? GROUP BY d`)
      .bind(userId, weekStart),
    db.prepare(`SELECT date(logged_at, '${mod}') as d, COALESCE(SUM(points), 0) as pts FROM entries WHERE user_id = ? AND date(logged_at, '${mod}') >= ? AND date(logged_at, '${mod}') <= ? GROUP BY d`)
      .bind(userId, monthStart, today),
    db.prepare(`SELECT CAST(strftime('%m', logged_at, '${mod}') AS INTEGER) - 1 as m, COALESCE(SUM(points), 0) as pts FROM entries WHERE user_id = ? AND date(logged_at, '${mod}') >= ? GROUP BY m`)
      .bind(userId, yearStart),
    db.prepare(`SELECT habit_id, date(logged_at, '${mod}') as d, COUNT(*) as cnt FROM entries WHERE user_id = ? AND date(logged_at, '${mod}') >= ? GROUP BY habit_id, d`)
      .bind(userId, heatStart),
  ]);

  const totalPoints = (totalRes.results[0] as { total: number }).total;
  const totalDays = (activeDaysRes.results[0] as { days: number }).days;

  // Streak
  let streak = 0;
  const checkDate = new Date(today + 'T12:00:00Z');
  for (const { d } of streakRes.results as { d: string }[]) {
    if (d !== toLocalDateStr(checkDate.toISOString(), tz)) break;
    streak++;
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  }

  const level = Math.floor(totalPoints / 500) + 1;
  const levelXp = totalPoints % 500;
  const levelNext = 500;

  // Week chart
  const weekMap = new Map<string, number>((weekRes.results as { d: string; pts: number }[]).map(r => [r.d, r.pts]));
  const todayPoints = weekMap.get(today) ?? 0;
  const weekTotal = [...weekMap.values()].reduce((s, v) => s + v, 0);
  const weekAvg = weekTotal / 7;
  const allTimeAvg = totalDays > 0 ? totalPoints / totalDays : 0;
  const weekPct = allTimeAvg > 0 ? Math.round((weekAvg / allTimeAvg) * 100) : 0;

  const dayLetters = ['D','L','M','X','J','V','S'];
  const weekChart = Array.from({ length: 7 }, (_, i) => {
    const localDate = addDays(today, -(6 - i));
    const [y, mo, d] = localDate.split('-').map(Number);
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    return { label: dayLetters[dow], points: weekMap.get(localDate) ?? 0, today: i === 6 };
  });

  // Day chart (6 × 4-hour buckets)
  const dayMap = new Map<number, number>((dayRes.results as { h: number; pts: number }[]).map(r => [r.h, r.pts]));
  const localNowHour = new Date(Date.now() + offset * 60000).getUTCHours();
  const dayChart = ['0-4','4-8','8-12','12-16','16-20','20-24'].map((label, i) => {
    let pts = 0;
    for (let h = i * 4; h < (i + 1) * 4; h++) pts += dayMap.get(h) ?? 0;
    return { label, points: pts, today: i === Math.floor(localNowHour / 4) };
  });

  // Month chart (5 weekly buckets)
  const monthDateMap = new Map<string, number>((monthRes.results as { d: string; pts: number }[]).map(r => [r.d, r.pts]));
  const monthChart = Array.from({ length: 5 }, (_, i) => {
    const startLocal = addDays(today, -(4 - i) * 7);
    const endLocal = i < 4 ? addDays(today, -(3 - i) * 7) : addDays(today, 1);
    let pts = 0;
    let cur = startLocal;
    while (cur < endLocal) {
      pts += monthDateMap.get(cur) ?? 0;
      cur = addDays(cur, 1);
    }
    return { label: `s${i + 1}`, points: pts, today: i === 4 };
  });

  // Year chart (12 month buckets by month number)
  const yearMonthMap = new Map<number, number>((yearRes.results as { m: number; pts: number }[]).map(r => [r.m, r.pts]));
  const monthLetters = ['E','F','M','A','M','J','J','A','S','O','N','D'];
  const currentMonth = parseInt(today.split('-')[1]) - 1;
  const yearChart = Array.from({ length: 12 }, (_, m) => ({
    label: monthLetters[m],
    points: yearMonthMap.get(m) ?? 0,
    today: m === currentMonth,
  }));

  // Habit heatmaps
  type HeatRow = { habit_id: string; d: string; cnt: number };
  const heatByHabit = new Map<string, Map<string, number>>();
  for (const r of heatRes.results as HeatRow[]) {
    if (!heatByHabit.has(r.habit_id)) heatByHabit.set(r.habit_id, new Map());
    heatByHabit.get(r.habit_id)!.set(r.d, r.cnt);
  }
  const habitHeatmaps = [...heatByHabit.entries()].map(([habitId, dayMap]) => ({
    habitId,
    values: Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, -(13 - i));
      return Math.min(1, (dayMap.get(d) ?? 0) * 0.5);
    }),
  }));

  return c.json({
    totalPoints,
    streak,
    level,
    levelXp,
    levelNext,
    todayPoints,
    weekPct,
    dayChart,
    weekChart,
    monthChart,
    yearChart,
    habitHeatmaps,
  });
});

export default points;
