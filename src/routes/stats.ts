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

  // Get user timezone
  const user = await db.prepare('SELECT timezone FROM users WHERE id = ?').bind(userId).first<{ timezone: string }>();
  const tz = user?.timezone ?? 'UTC';

  // All entries for this user
  const allEntries = await db
    .prepare('SELECT points, logged_at FROM entries WHERE user_id = ? ORDER BY logged_at ASC')
    .bind(userId)
    .all<{ points: number; logged_at: string }>();

  const rows = allEntries.results;

  // Total points
  const totalPoints = rows.reduce((s, r) => s + r.points, 0);

  // Today's points
  const today = todayLocal(tz);
  const todayPoints = rows
    .filter((r) => toLocalDateStr(r.logged_at, tz) === today)
    .reduce((s, r) => s + r.points, 0);

  // Streak: consecutive days with at least 1 entry (ending today or yesterday)
  const daySet = new Set(rows.map((r) => toLocalDateStr(r.logged_at, tz)));
  let streak = 0;
  const check = new Date(today);
  while (daySet.has(check.toISOString().slice(0, 10))) {
    streak++;
    check.setDate(check.getDate() - 1);
  }

  // Weekly chart: last 7 days pts per day
  const weeklyChart: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const pts = rows.filter((r) => toLocalDateStr(r.logged_at, tz) === ds).reduce((s, r) => s + r.points, 0);
    weeklyChart.push(pts);
  }

  // Heatmap: 14 weeks × 7 days = 98 values (0..1 intensity)
  const heatmap: number[] = [];
  const maxWeeklyPts = Math.max(...weeklyChart, 1);
  for (let i = 97; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const pts = rows.filter((r) => toLocalDateStr(r.logged_at, tz) === ds).reduce((s, r) => s + r.points, 0);
    heatmap.push(Math.min(1, pts / (maxWeeklyPts || 1)));
  }

  // Level: every 500 pts = 1 level
  const level = Math.floor(totalPoints / 500) + 1;
  const levelXp = totalPoints % 500;
  const levelNext = 500;

  // Week completion %
  const weekTotal = weeklyChart.reduce((s, v) => s + v, 0);
  const weekAvg = weekTotal / 7;
  const allTimeAvg = rows.length ? totalPoints / Math.max(daySet.size, 1) : 0;
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
    heatmap,
    timezone: tz,
  });
});

export default stats;
