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

function toLocalHour(isoUtc: string, timezone: string): number {
  try {
    const timeStr = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, timeStyle: 'short' }).format(new Date(isoUtc));
    return parseInt(timeStr.split(':')[0]);
  } catch {
    return new Date(isoUtc).getUTCHours();
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

  // Fetch ~1 year of entries (extra day buffer for timezone edge cases)
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  yearAgo.setUTCDate(yearAgo.getUTCDate() - 1);

  const rows = (await db
    .prepare('SELECT habit_id, points, logged_at FROM entries WHERE user_id = ? AND logged_at >= ? ORDER BY logged_at ASC')
    .bind(userId, yearAgo.toISOString())
    .all<{ habit_id: string; points: number; logged_at: string }>()).results;

  // ── Day chart (6 bars, 4-hr buckets) ──────────────────────────────────────
  const nowHour = toLocalHour(new Date().toISOString(), tz);
  const dayChart = ['0-4','4-8','8-12','12-16','16-20','20-24'].map((label, i) => {
    const pts = rows
      .filter(r => toLocalDateStr(r.logged_at, tz) === today && toLocalHour(r.logged_at, tz) >= i * 4 && toLocalHour(r.logged_at, tz) < (i + 1) * 4)
      .reduce((s, r) => s + r.points, 0);
    return { label, points: pts, today: i === Math.floor(nowHour / 4) };
  });

  // ── Week chart (7 bars, last 7 days) ──────────────────────────────────────
  const dayLetters = ['D','L','M','X','J','V','S'];
  const weekChart = Array.from({ length: 7 }, (_, i) => {
    const localDate = addDays(today, -(6 - i));
    const [y, mo, d] = localDate.split('-').map(Number);
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    const pts = rows.filter(r => toLocalDateStr(r.logged_at, tz) === localDate).reduce((s, r) => s + r.points, 0);
    return { label: dayLetters[dow], points: pts, today: i === 6 };
  });

  // ── Month chart (5 bars, 5 weekly buckets) ────────────────────────────────
  const monthChart = Array.from({ length: 5 }, (_, i) => {
    const startLocal = addDays(today, -(4 - i) * 7);
    const endLocal = i < 4 ? addDays(today, -(3 - i) * 7) : '9999-12-31';
    const pts = rows.filter(r => {
      const d = toLocalDateStr(r.logged_at, tz);
      return d >= startLocal && d < endLocal;
    }).reduce((s, r) => s + r.points, 0);
    return { label: `s${i + 1}`, points: pts, today: i === 4 };
  });

  // ── Year chart (12 bars, by month number) ─────────────────────────────────
  const monthLetters = ['E','F','M','A','M','J','J','A','S','O','N','D'];
  const currentMonth = parseInt(today.split('-')[1]) - 1;
  const yearChart = Array.from({ length: 12 }, (_, m) => {
    const pts = rows
      .filter(r => parseInt(toLocalDateStr(r.logged_at, tz).split('-')[1]) - 1 === m)
      .reduce((s, r) => s + r.points, 0);
    return { label: monthLetters[m], points: pts, today: m === currentMonth };
  });

  // ── Habit heatmaps (14 days per active habit) ─────────────────────────────
  const habitIds = (await db
    .prepare('SELECT id FROM habits WHERE user_id = ? AND archived_at IS NULL')
    .bind(userId)
    .all<{ id: string }>()).results.map(h => h.id);

  const habitHeatmaps = habitIds.map(habitId => {
    const byDay: Record<string, number> = {};
    rows.filter(r => r.habit_id === habitId).forEach(r => {
      const d = toLocalDateStr(r.logged_at, tz);
      byDay[d] = (byDay[d] ?? 0) + 1;
    });
    const values = Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, -(13 - i));
      return Math.min(1, (byDay[d] ?? 0) * 0.5);
    });
    return { habitId, values };
  });

  return c.json({ dayChart, weekChart, monthChart, yearChart, habitHeatmaps });
});

export default points;
