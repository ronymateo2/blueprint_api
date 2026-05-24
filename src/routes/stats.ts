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

// Snapshot of current UTC offset in minutes for the given timezone.
// Used to build SQLite date modifiers (e.g. "+330 minutes") for local-date grouping.
// Approximation during DST transitions (±1h) — acceptable for habit tracking.
function getOffsetMinutes(tz: string): number {
  try {
    const now = new Date();
    const localStr = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz,
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(now);
    return Math.round((new Date(localStr.replace(' ', 'T') + 'Z').getTime() - now.getTime()) / 60000);
  } catch {
    return 0;
  }
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

stats.get('/home', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const user = await db.prepare('SELECT timezone FROM users WHERE id = ?').bind(userId).first<{ timezone: string }>();
  const tz = user?.timezone ?? 'UTC';
  const today = todayLocal(tz);

  const offset = getOffsetMinutes(tz);
  const mod = `${offset >= 0 ? '+' : ''}${offset} minutes`;

  const weekBase = new Date(today + 'T12:00:00Z');

  const weekStartDate = new Date(weekBase);
  weekStartDate.setUTCDate(weekBase.getUTCDate() - 6);
  const weekStart = toLocalDateStr(weekStartDate.toISOString(), tz);

  const streakCutoffDate = new Date(weekBase);
  streakCutoffDate.setUTCDate(weekBase.getUTCDate() - 399);
  const streakCutoff = toLocalDateStr(streakCutoffDate.toISOString(), tz);

  const [weekResult, streakResult] = await db.batch([
    db.prepare(`SELECT date(logged_at, '${mod}') as d, COALESCE(SUM(points), 0) as pts FROM entries WHERE user_id = ? AND date(logged_at, '${mod}') >= ? GROUP BY d`).bind(userId, weekStart),
    db.prepare(`SELECT DISTINCT date(logged_at, '${mod}') as d FROM entries WHERE user_id = ? AND date(logged_at, '${mod}') >= ? ORDER BY d DESC`).bind(userId, streakCutoff),
  ]);

  const weekMap = new Map<string, number>(
    (weekResult.results as { d: string; pts: number }[]).map(r => [r.d, r.pts])
  );
  const todayPoints = weekMap.get(today) ?? 0;

  const weeklyChart: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(weekBase);
    d.setUTCDate(weekBase.getUTCDate() - i);
    weeklyChart.push(weekMap.get(toLocalDateStr(d.toISOString(), tz)) ?? 0);
  }

  let streak = 0;
  const checkDate = new Date(today + 'T12:00:00Z');
  for (const { d } of streakResult.results as { d: string }[]) {
    if (d !== toLocalDateStr(checkDate.toISOString(), tz)) break;
    streak++;
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  }

  return c.json({ todayPoints, streak, weeklyChart });
});

export default stats;
