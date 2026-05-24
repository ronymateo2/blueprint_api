import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';

type Bindings = Env;
type Variables = { userId: string; userEmail: string };

const stats = new Hono<{ Bindings: Bindings; Variables: Variables }>();

stats.use('*', authMiddleware);

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

stats.get('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const user = await db.prepare('SELECT timezone FROM users WHERE id = ?').bind(userId).first<{ timezone: string }>();
  const tz = user?.timezone ?? 'UTC';
  const today = todayLocal(tz);

  const allEntries = await db
    .prepare('SELECT points, logged_at FROM entries WHERE user_id = ? ORDER BY logged_at ASC')
    .bind(userId)
    .all<{ points: number; logged_at: string }>();

  const rows = allEntries.results;

  // Single O(n) pass: build date→points map, accumulate total
  const dayPts = new Map<string, number>();
  let totalPoints = 0;
  for (const r of rows) {
    const d = toLocalDateStr(r.logged_at, tz);
    dayPts.set(d, (dayPts.get(d) ?? 0) + r.points);
    totalPoints += r.points;
  }

  const todayPoints = dayPts.get(today) ?? 0;

  // Streak: walk backwards from today using Map.has() — O(streak length)
  let streak = 0;
  const checkDate = new Date(today + 'T12:00:00Z');
  while (dayPts.has(toLocalDateStr(checkDate.toISOString(), tz))) {
    streak++;
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  }

  // Weekly chart: last 7 days — O(7) map lookups
  const weeklyChart: number[] = [];
  const weekBase = new Date(today + 'T12:00:00Z');
  for (let i = 6; i >= 0; i--) {
    const d = new Date(weekBase);
    d.setUTCDate(weekBase.getUTCDate() - i);
    weeklyChart.push(dayPts.get(toLocalDateStr(d.toISOString(), tz)) ?? 0);
  }

  const level = Math.floor(totalPoints / 500) + 1;
  const levelXp = totalPoints % 500;
  const levelNext = 500;

  const weekTotal = weeklyChart.reduce((s, v) => s + v, 0);
  const weekAvg = weekTotal / 7;
  const allTimeAvg = dayPts.size > 0 ? totalPoints / dayPts.size : 0;
  const weekPct = allTimeAvg > 0 ? Math.round((weekAvg / allTimeAvg) * 100) : 0;

  return c.json({
    totalPoints,
    todayPoints,
    streak,
    level,
    levelXp,
    levelNext,
    weekPct,
    weeklyChart,
    timezone: tz,
  });
});

export default stats;
