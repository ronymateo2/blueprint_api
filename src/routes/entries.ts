import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';
import { entryCreateSchema } from '../schemas';

type Bindings = Env;
type Variables = { userId: string; userEmail: string };

const entries = new Hono<{ Bindings: Bindings; Variables: Variables }>();

entries.use('*', authMiddleware);

// ── List ──────────────────────────────────────────────────────────────────────

entries.get('/', async (c) => {
  const userId = c.get('userId');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const habitId = c.req.query('habit_id');

  let query = 'SELECT e.*, h.name as habit_name, h.icon as habit_icon FROM entries e JOIN habits h ON h.id = e.habit_id WHERE e.user_id = ?';
  const binds: unknown[] = [userId];

  if (from) { query += ' AND e.logged_at >= ?'; binds.push(from); }
  if (to)   { query += ' AND e.logged_at <= ?'; binds.push(to); }
  if (habitId) { query += ' AND e.habit_id = ?'; binds.push(habitId); }

  query += ' ORDER BY e.logged_at DESC';

  const rows = await c.env.DB.prepare(query).bind(...binds).all();
  return c.json(rows.results);
});

// ── Create ────────────────────────────────────────────────────────────────────

entries.post('/', zValidator('json', entryCreateSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  // Verify habit belongs to user and get points
  const habit = await c.env.DB.prepare('SELECT id, points, type FROM habits WHERE id = ? AND user_id = ?')
    .bind(body.habit_id, userId)
    .first<{ id: string; points: number; type: string }>();
  if (!habit) return c.json({ error: 'Habit not found' }, 404);

  const id = newId();
  const now = nowIso();
  const loggedAt = body.logged_at ?? now;
  const value = body.value ?? 1;
  const entryPoints = (habit.type === 'time' || habit.type === 'count' || habit.type === 'qty')
    ? habit.points * value
    : habit.points;

  await c.env.DB.prepare(
    'INSERT INTO entries (id, user_id, habit_id, value, points, logged_at, note, alignment, day_energy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, body.habit_id, value, entryPoints, loggedAt, body.note ?? null, body.alignment ?? null, body.day_energy ?? null, now)
    .run();

  const entry = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first();
  return c.json(entry, 201);
});

// ── Delete (undo) ─────────────────────────────────────────────────────────────

entries.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const result = await c.env.DB.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default entries;
