import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import habits from './routes/habits';
import reminders from './routes/reminders';
import entries from './routes/entries';
import stats from './routes/stats';

const app = new Hono<{ Bindings: Env }>();

// CORS — allow frontend origin (configured via env var)
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const allowed = c.env.ALLOWED_ORIGIN ?? '*';
      if (allowed === '*') return '*';
      // Allow localhost variants in dev
      if (origin?.startsWith('http://localhost')) return origin;
      return origin === allowed ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

app.route('/api/auth', auth);
app.route('/api/habits', habits);
app.route('/api/reminders', reminders);
app.route('/api/entries', entries);
app.route('/api/stats', stats);

app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
