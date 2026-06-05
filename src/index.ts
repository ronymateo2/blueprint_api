import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import auth from './routes/auth';
import habits from './routes/habits';
import reminders from './routes/reminders';
import entries from './routes/entries';
import stats from './routes/stats';
import points from './routes/points';
import skips from './routes/skips';
import friction from './routes/friction';
import { authRateLimit } from './middleware/rateLimit';

const LOCALHOST_RE = /^http:\/\/localhost(:\d+)?$/;

const app = new Hono<{ Bindings: Env }>();

// Validate JWT_SECRET length on first request — fail loudly rather than silently accept a weak secret
app.use('/api/*', async (c, next) => {
  if (c.env.JWT_SECRET && c.env.JWT_SECRET.length < 32) {
    console.error('JWT_SECRET must be at least 32 characters');
    return c.json({ error: 'Server misconfiguration' }, 500);
  }
  return next();
});

// Security headers
app.use('/api/*', secureHeaders({
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
  xFrameOptions: 'DENY',
  contentSecurityPolicy: { defaultSrc: ["'none'"] },
}));

// CORS — allow frontend origin; never fall back to *
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const allowed = c.env.ALLOWED_ORIGIN;
      if (!allowed) return null;
      if (LOCALHOST_RE.test(origin ?? '')) return origin!;
      return origin === allowed ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
    credentials: true,
  }),
);

// Rate limit the OAuth callback — per IP
app.use('/api/auth/google/callback', authRateLimit);

app.route('/api/auth', auth);
app.route('/api/habits', habits);
app.route('/api/reminders', reminders);
app.route('/api/entries', entries);
app.route('/api/stats', stats);
app.route('/api/points', points);
app.route('/api/skips', skips);
app.route('/api/friction', friction);

app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
