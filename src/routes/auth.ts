import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { signJwt } from '../lib/jwt';
import { newId, nowIso } from '../lib/id';
import { randomState, timingSafeEqual } from '../lib/crypto';
import { authMiddleware } from '../middleware/auth';
import { meUpdateSchema } from '../schemas';

type Bindings = Env;
type Variables = { userId: string; userEmail: string };

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Google OAuth ─────────────────────────────────────────────────────────────

auth.get('/google', (c) => {
  const state = randomState();
  const isSecure = new URL(c.req.url).protocol === 'https:';

  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  });

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const stateQuery = c.req.query('state');
  const stateCookie = getCookie(c, 'oauth_state');

  // Validate state to prevent CSRF
  if (!code) return c.json({ error: 'Missing code' }, 400);
  if (!stateQuery || !stateCookie || !timingSafeEqual(stateQuery, stateCookie)) {
    return c.json({ error: 'Invalid state' }, 400);
  }

  // Consume the state cookie
  deleteCookie(c, 'oauth_state', { path: '/' });

  const origin = new URL(c.req.url).origin;
  const isSecure = new URL(c.req.url).protocol === 'https:';

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return c.json({ error: 'Token exchange failed' }, 400);
  }

  const tokens = await tokenRes.json<{ id_token: string; access_token: string }>();

  // Get user info from Google
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return c.json({ error: 'Failed to fetch user info' }, 400);
  }

  const googleUser = await userRes.json<{
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  }>();

  const db = c.env.DB;
  const now = nowIso();

  // Upsert oauth_account → find or create user
  const existing = await db
    .prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_id = ?')
    .bind('google', googleUser.sub)
    .first<{ user_id: string }>();

  let userId: string;

  if (existing) {
    userId = existing.user_id;
    // Update avatar/name in case they changed
    await db
      .prepare('UPDATE users SET display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?')
      .bind(googleUser.name ?? null, googleUser.picture ?? null, now, userId)
      .run();
  } else {
    // Always create a new user — never silently link by email
    userId = newId();
    await db
      .prepare(
        'INSERT INTO users (id, email, display_name, avatar_url, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(userId, googleUser.email, googleUser.name ?? null, googleUser.picture ?? null, 'UTC', now, now)
      .run();

    await db
      .prepare(
        'INSERT INTO oauth_accounts (id, user_id, provider, provider_id, email, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(newId(), userId, 'google', googleUser.sub, googleUser.email, now)
      .run();
  }

  const userRow = await db.prepare('SELECT timezone FROM users WHERE id = ?').bind(userId).first<{ timezone: string }>();
  const jwt = await signJwt({ sub: userId, email: googleUser.email, timezone: userRow?.timezone ?? 'UTC' }, c.env.JWT_SECRET);

  // Set JWT as HttpOnly cookie — never in URL
  setCookie(c, 'session', jwt, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });

  return c.redirect(`${c.env.APP_URL}/auth/callback`);
});

// ── Logout ────────────────────────────────────────────────────────────────────

auth.post('/logout', (c) => {
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});

// ── Profile ───────────────────────────────────────────────────────────────────

auth.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT id, email, display_name, avatar_url, timezone, identity FROM users WHERE id = ?')
    .bind(userId)
    .first();
  if (!user) return c.json({ error: 'User not found' }, 404);
  return c.json(user);
});

auth.patch('/me', authMiddleware, zValidator('json', meUpdateSchema), async (c) => {
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  const body = c.req.valid('json');
  const now = nowIso();
  await c.env.DB.prepare(
    'UPDATE users SET timezone = COALESCE(?, timezone), display_name = COALESCE(?, display_name), identity = COALESCE(?, identity), updated_at = ? WHERE id = ?',
  )
    .bind(body.timezone ?? null, body.display_name ?? null, body.identity ?? null, now, userId)
    .run();
  const user = await c.env.DB.prepare('SELECT id, email, display_name, avatar_url, timezone, identity FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string; display_name: string | null; avatar_url: string | null; timezone: string; identity: string | null }>();
  if (!user) return c.json({ error: 'User not found' }, 404);
  let token: string | undefined;
  if (body.timezone) {
    token = await signJwt({ sub: userId, email: userEmail, timezone: user.timezone }, c.env.JWT_SECRET);
  }
  return c.json({ ...user, token });
});

export default auth;
