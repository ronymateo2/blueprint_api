import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { reminderUpdateSchema } from '../schemas';

type Bindings = Env;
type Variables = { userId: string; userEmail: string };

const reminders = new Hono<{ Bindings: Bindings; Variables: Variables }>();

reminders.use('*', authMiddleware);

reminders.put('/:id', zValidator('json', reminderUpdateSchema), async (c) => {
  const userId = c.get('userId');
  const reminderId = c.req.param('id');

  // Verify ownership via habit
  const rem = await c.env.DB.prepare(
    `SELECT r.id FROM reminders r
     JOIN habits h ON h.id = r.habit_id
     WHERE r.id = ? AND h.user_id = ?`,
  )
    .bind(reminderId, userId)
    .first();
  if (!rem) return c.json({ error: 'Not found' }, 404);

  const body = c.req.valid('json');
  await c.env.DB.prepare(
    'UPDATE reminders SET time = COALESCE(?, time), days = COALESCE(?, days), enabled = COALESCE(?, enabled) WHERE id = ?',
  )
    .bind(body.time ?? null, body.days ?? null, body.enabled ?? null, reminderId)
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM reminders WHERE id = ?').bind(reminderId).first();
  return c.json(updated);
});

reminders.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const reminderId = c.req.param('id');

  const rem = await c.env.DB.prepare(
    `SELECT r.id FROM reminders r
     JOIN habits h ON h.id = r.habit_id
     WHERE r.id = ? AND h.user_id = ?`,
  )
    .bind(reminderId, userId)
    .first();
  if (!rem) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare('DELETE FROM reminders WHERE id = ?').bind(reminderId).run();
  return c.json({ ok: true });
});

export default reminders;
