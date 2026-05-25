import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { newId, nowIso } from '../lib/id';
import { habitCreateSchema, habitUpdateSchema, reminderCreateSchema } from '../schemas';

type Bindings = Env;
type Variables = { userId: string; userEmail: string };

const habits = new Hono<{ Bindings: Bindings; Variables: Variables }>();

habits.use('*', authMiddleware);

// ── List ──────────────────────────────────────────────────────────────────────

habits.get('/', async (c) => {
  const userId = c.get('userId');
  const archived = c.req.query('archived') === '1';
  const rows = await c.env.DB.prepare(
    `SELECT h.*, json_group_array(
      json_object('id', r.id, 'time', r.time, 'days', r.days, 'enabled', r.enabled)
    ) as reminders_json
    FROM habits h
    LEFT JOIN reminders r ON r.habit_id = h.id
    WHERE h.user_id = ? AND ${archived ? 'h.archived_at IS NOT NULL' : 'h.archived_at IS NULL'}
    GROUP BY h.sort_order, h.created_at, h.id
    ORDER BY h.sort_order ASC, h.created_at ASC, h.id ASC`,
  )
    .bind(userId)
    .all();

  const result = rows.results.map((h: Record<string, unknown>) => ({
    ...h,
    reminders: JSON.parse((h.reminders_json as string) || '[]').filter((r: { id: string | null }) => r.id !== null),
    reminders_json: undefined,
  }));

  return c.json(result);
});

// ── Create ────────────────────────────────────────────────────────────────────

habits.post('/', zValidator('json', habitCreateSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    'INSERT INTO habits (id, user_id, name, icon, type, goal, unit, points, sort_order, frequency_type, frequency_config, start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      userId,
      body.name,
      body.icon ?? 'star',
      body.type,
      body.goal ?? 1,
      body.unit ?? null,
      body.points ?? 5,
      body.sort_order ?? 0,
      body.frequency_type ?? 'daily',
      body.frequency_config ?? '{}',
      body.start_date ?? null,
      body.end_date ?? null,
      now,
      now,
    )
    .run();

  const habit = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ?').bind(id).first();
  return c.json({ ...habit, reminders: [] }, 201);
});

// ── Get one ───────────────────────────────────────────────────────────────────

habits.get('/:id', async (c) => {
  const userId = c.get('userId');
  const habit = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .first();
  if (!habit) return c.json({ error: 'Not found' }, 404);
  const reminders = await c.env.DB.prepare('SELECT * FROM reminders WHERE habit_id = ?')
    .bind(c.req.param('id'))
    .all();
  return c.json({ ...habit, reminders: reminders.results });
});

// ── Update ────────────────────────────────────────────────────────────────────

habits.put('/:id', zValidator('json', habitUpdateSchema), async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const habit = await c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first();
  if (!habit) return c.json({ error: 'Not found' }, 404);

  const body = c.req.valid('json');
  const now = nowIso();
  const startDateSet = 'start_date' in body ? 1 : 0;
  const endDateSet = 'end_date' in body ? 1 : 0;
  await c.env.DB.prepare(
    `UPDATE habits SET
      name = COALESCE(?, name),
      icon = COALESCE(?, icon),
      type = COALESCE(?, type),
      goal = COALESCE(?, goal),
      unit = COALESCE(?, unit),
      points = COALESCE(?, points),
      sort_order = COALESCE(?, sort_order),
      frequency_type = COALESCE(?, frequency_type),
      frequency_config = COALESCE(?, frequency_config),
      start_date = CASE WHEN ? = 1 THEN ? ELSE start_date END,
      end_date = CASE WHEN ? = 1 THEN ? ELSE end_date END,
      updated_at = ?
    WHERE id = ?`,
  )
    .bind(
      body.name ?? null,
      body.icon ?? null,
      body.type ?? null,
      body.goal ?? null,
      body.unit ?? null,
      body.points ?? null,
      body.sort_order ?? null,
      body.frequency_type ?? null,
      body.frequency_config ?? null,
      startDateSet, body.start_date ?? null,
      endDateSet, body.end_date ?? null,
      now,
      id,
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM habits WHERE id = ?').bind(id).first();
  const reminders = await c.env.DB.prepare('SELECT * FROM reminders WHERE habit_id = ?').bind(id).all();
  return c.json({ ...updated, reminders: reminders.results });
});

// ── Archive / Unarchive ───────────────────────────────────────────────────────

habits.patch('/:id/archive', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const now = nowIso();
  const result = await c.env.DB.prepare(
    'UPDATE habits SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
  )
    .bind(now, now, id, userId)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

habits.patch('/:id/unarchive', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const now = nowIso();
  const result = await c.env.DB.prepare(
    'UPDATE habits SET archived_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?',
  )
    .bind(now, id, userId)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ── Delete ────────────────────────────────────────────────────────────────────

habits.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const result = await c.env.DB.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ── Reminders (nested) ────────────────────────────────────────────────────────

habits.get('/:id/reminders', async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('id');
  const habit = await c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?')
    .bind(habitId, userId)
    .first();
  if (!habit) return c.json({ error: 'Not found' }, 404);
  const rows = await c.env.DB.prepare('SELECT * FROM reminders WHERE habit_id = ?').bind(habitId).all();
  return c.json(rows.results);
});

habits.post('/:id/reminders', zValidator('json', reminderCreateSchema), async (c) => {
  const userId = c.get('userId');
  const habitId = c.req.param('id');
  const habit = await c.env.DB.prepare('SELECT id FROM habits WHERE id = ? AND user_id = ?')
    .bind(habitId, userId)
    .first();
  if (!habit) return c.json({ error: 'Not found' }, 404);

  const body = c.req.valid('json');

  const id = newId();
  await c.env.DB.prepare('INSERT INTO reminders (id, habit_id, time, days, enabled) VALUES (?, ?, ?, ?, ?)')
    .bind(id, habitId, body.time, body.days ?? 'LMXJVSD', body.enabled ?? 1)
    .run();
  const reminder = await c.env.DB.prepare('SELECT * FROM reminders WHERE id = ?').bind(id).first();
  return c.json(reminder, 201);
});

export default habits;
