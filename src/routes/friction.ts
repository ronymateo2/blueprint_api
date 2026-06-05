import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';
import { frictionSaveSchema } from '../schemas';

type Bindings = Env;
type Variables = { userId: string; userEmail: string };

const friction = new Hono<{ Bindings: Bindings; Variables: Variables }>();

friction.use('*', authMiddleware);

// GET /api/friction?habit_id=&from=&to=  (from/to son local_date YYYY-MM-DD)
friction.get('/', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.query('habit_id');
  const from = c.req.query('from');
  const to = c.req.query('to');

  let query = 'SELECT habit_id, local_date, cause, note FROM friction_logs WHERE user_id = ?';
  const binds: unknown[] = [userId];
  if (habitId) { query += ' AND habit_id = ?'; binds.push(habitId); }
  if (from) { query += ' AND local_date >= ?'; binds.push(from); }
  if (to) { query += ' AND local_date <= ?'; binds.push(to); }
  query += ' ORDER BY local_date DESC';

  const rows = await c.env.DB.prepare(query).bind(...binds).all();
  return c.json(rows.results);
});

// POST /api/friction  (upsert idempotente por habit/día)
friction.post('/', zValidator('json', frictionSaveSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const habit = await c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?')
    .bind(body.habit_id, userId)
    .first();
  if (!habit) return c.json({ error: 'Habit not found' }, 404);

  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO friction_logs (id, user_id, habit_id, local_date, cause, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, habit_id, local_date)
     DO UPDATE SET cause = excluded.cause, note = excluded.note, updated_at = excluded.updated_at`,
  )
    .bind(id, userId, body.habit_id, body.local_date, body.cause, body.note ?? null, now, now)
    .run();

  return c.json({ habit_id: body.habit_id, local_date: body.local_date, cause: body.cause, note: body.note ?? null }, 201);
});

export default friction;
