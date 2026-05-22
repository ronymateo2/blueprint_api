import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';

type Bindings = Env;
type Variables = { userId: string; userEmail: string };

const skips = new Hono<{ Bindings: Bindings; Variables: Variables }>();

skips.use('*', authMiddleware);

// GET /api/skips?local_date=YYYY-MM-DD  OR  ?habit_id=:id
skips.get('/', async (c) => {
  const userId = c.get('userId');
  const local_date = c.req.query('local_date');
  const habit_id = c.req.query('habit_id');

  if (habit_id) {
    const habit = await c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?')
      .bind(habit_id, userId)
      .first();
    if (!habit) return c.json({ error: 'Not found' }, 404);
    const rows = await c.env.DB.prepare(
      'SELECT habit_id, local_date FROM habit_skips WHERE user_id = ? AND habit_id = ?',
    )
      .bind(userId, habit_id)
      .all();
    return c.json(rows.results.map((r: Record<string, unknown>) => ({
      habit_id: r.habit_id as string,
      local_date: r.local_date as string,
    })));
  }

  if (!local_date) return c.json({ error: 'local_date or habit_id required' }, 400);
  const rows = await c.env.DB.prepare(
    'SELECT habit_id FROM habit_skips WHERE user_id = ? AND local_date = ?',
  )
    .bind(userId, local_date)
    .all();
  return c.json(rows.results.map((r: Record<string, unknown>) => ({ habit_id: r.habit_id as string, local_date })));
});

// POST /api/skips  { habit_id, local_date }
skips.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ habit_id: string; local_date: string }>();
  if (!body.habit_id || !body.local_date) return c.json({ error: 'habit_id and local_date required' }, 400);

  const habit = await c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?')
    .bind(body.habit_id, userId)
    .first();
  if (!habit) return c.json({ error: 'Not found' }, 404);

  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO habit_skips (id, user_id, habit_id, local_date, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, userId, body.habit_id, body.local_date, now)
    .run();

  return c.json({ habit_id: body.habit_id, local_date: body.local_date }, 201);
});

// DELETE /api/skips/:habit_id?local_date=YYYY-MM-DD
skips.delete('/:habit_id', async (c) => {
  const userId = c.get('userId');
  const habit_id = c.req.param('habit_id');
  const local_date = c.req.query('local_date');
  if (!local_date) return c.json({ error: 'local_date required' }, 400);
  await c.env.DB.prepare(
    'DELETE FROM habit_skips WHERE user_id = ? AND habit_id = ? AND local_date = ?',
  )
    .bind(userId, habit_id, local_date)
    .run();
  return c.json({ ok: true });
});

export default skips;
